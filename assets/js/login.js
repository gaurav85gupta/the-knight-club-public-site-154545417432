/**
 * Login page controller.
 *
 * Two forms on one page:
 *   #login-form         email + password (DEFAULT, visible)  -> Auth.loginWithEmail
 *   #legacy-login-form  User ID + password (collapsed)        -> Auth.login (unchanged)
 * plus Google Sign-In. #toggle-legacy-login / #toggle-email-login swap which
 * form is visible; only the visible form's inputs are "required" in spirit —
 * both are independently validated and submitted, so a hidden form can never
 * accidentally submit.
 *
 * ERROR HANDLING MAP — EMAIL FORM
 *   401  wrong email or password     -> generic banner message (never
 *                                        pinned to one field — see below)
 *   403  suspended / unverified      -> backend's specific message
 *                                        (verified via err.message, since
 *                                        both are 403 but need different
 *                                        calls to action)
 *   429  rate limited                -> "too many attempts"
 *   0    network / timeout           -> connection message
 *   422  malformed input             -> field errors
 *
 * ERROR HANDLING MAP — LEGACY USER-ID FORM: unchanged from the original
 * single-page login (see login.js.bak) — same 401/403/429/422 handling,
 * same Auth.login() call.
 *
 * Both forms clear their password field after any failed attempt.
 */

(function initLoginPage() {
  const emailForm = document.getElementById('login-form');
  const legacyForm = document.getElementById('legacy-login-form');
  if (!emailForm || !legacyForm) return;

  const alertEl = document.getElementById('form-alert');
  const emailSubmitBtn = emailForm.querySelector('#submit-btn');
  const legacySubmitBtn = legacyForm.querySelector('#legacy-submit-btn');
  const toggleToLegacyBtn = document.getElementById('toggle-legacy-login');
  const toggleToEmailBtn = document.getElementById('toggle-email-login');
  const toggleEmailWrap = document.getElementById('toggle-email-wrap');

  Forms.initPasswordToggles(emailForm);
  Forms.initPasswordToggles(legacyForm);

  // One-shot notice from signup / verify-email / reset-password / a
  // session-expiry redirect.
  const notice = Auth.consumeNotice();
  if (notice) {
    Forms.showAlert(alertEl, notice.message, notice.kind === 'success' ? 'success' : notice.kind === 'error' ? 'error' : 'info');
  }

  const params = new URLSearchParams(window.location.search);
  const destination = () => Auth.safeNext(params.get('next'));

  Auth.init().then((user) => {
    if (user) window.location.replace(destination());
  });

  // ---- Google Sign-In -------------------------------------------------------
  GoogleSignIn.render({
    container: document.getElementById('google-login-btn'),
    onStart: () => Forms.hideAlert(alertEl),
    onSuccess: (user, isNewAccount) => {
      if (isNewAccount && user.needsProfileCompletion) {
        window.location.replace('complete-profile.html');
      } else {
        window.location.replace(destination());
      }
    },
    onError: (message) => Forms.showAlert(alertEl, message),
  });

  // ---- Toggle between email and legacy User-ID forms ------------------------
  function showLegacy() {
    emailForm.hidden = true;
    document.getElementById('google-login-btn').hidden = true;
    document.querySelector('.auth-divider').hidden = true;
    toggleToLegacyBtn.closest('.auth-method-toggle').hidden = true;
    legacyForm.hidden = false;
    toggleEmailWrap.hidden = false;
    Forms.hideAlert(alertEl);
    Forms.clearAllErrors(emailForm);
    legacyForm.elements.userId.focus();
  }
  function showEmail() {
    legacyForm.hidden = true;
    toggleEmailWrap.hidden = true;
    emailForm.hidden = false;
    document.getElementById('google-login-btn').hidden = false;
    document.querySelector('.auth-divider').hidden = false;
    toggleToLegacyBtn.closest('.auth-method-toggle').hidden = false;
    Forms.hideAlert(alertEl);
    Forms.clearAllErrors(legacyForm);
    emailForm.elements.email.focus();
  }
  toggleToLegacyBtn.addEventListener('click', showLegacy);
  toggleToEmailBtn.addEventListener('click', showEmail);

  // ---- Email + password form -------------------------------------------------
  function validateEmailForm() {
    let firstInvalid = null;
    const emailError = Forms.check.email(emailForm.elements.email.value);
    const pwError = emailForm.elements.password.value ? '' : 'Please provide your password.';

    if (emailError) { Forms.setFieldError(emailForm.elements.email, emailError); firstInvalid = emailForm.elements.email; }
    else Forms.clearFieldError(emailForm.elements.email);
    if (pwError) { Forms.setFieldError(emailForm.elements.password, pwError); firstInvalid = firstInvalid || emailForm.elements.password; }
    else Forms.clearFieldError(emailForm.elements.password);

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  for (const input of [emailForm.elements.email, emailForm.elements.password]) {
    input.addEventListener('input', () => {
      if (input.closest('.field').classList.contains('has-error')) Forms.clearFieldError(input);
    });
  }

  emailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (emailSubmitBtn.disabled) return;

    Forms.hideAlert(alertEl);
    Forms.clearAllErrors(emailForm);
    if (!validateEmailForm()) return;

    Forms.setLoading(emailSubmitBtn, true, 'Signing in…');
    try {
      await Auth.loginWithEmail({ email: emailForm.elements.email.value, password: emailForm.elements.password.value });
      window.location.replace(destination());
    } catch (err) {
      Forms.setLoading(emailSubmitBtn, false);
      emailForm.elements.password.value = '';

      if (!(err instanceof ApiError)) {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
      } else if (err.isNetworkError) {
        Forms.showAlert(alertEl, err.message);
      } else if (err.status === 401) {
        // Backend's generic message ("Invalid email or password."). Not
        // attached to a field — pointing at one would leak which was wrong.
        Forms.showAlert(alertEl, err.message);
        emailForm.elements.password.focus();
      } else if (err.status === 403) {
        // Covers BOTH "account suspended" and "please verify your email" —
        // the backend's message text already distinguishes them; the UI
        // doesn't need to branch, just display it.
        Forms.showAlert(alertEl, err.message);
      } else if (err.isRateLimited) {
        Forms.showAlert(alertEl, 'Too many sign-in attempts. Please wait a few minutes and try again.');
      } else if (err.isValidation) {
        const unmatched = Forms.applyServerErrors(emailForm, err.errors);
        if (unmatched.length || !err.errors.length) Forms.showAlert(alertEl, unmatched.join(' ') || err.message);
      } else {
        Forms.showAlert(alertEl, err.message || 'Something went wrong. Please try again.');
      }
      if (!alertEl.hidden && alertEl.focus) alertEl.focus();
    }
  });

  // ---- Legacy User-ID form (unchanged logic, moved into the collapsed face) -
  function validateLegacyForm() {
    let firstInvalid = null;
    const idError = legacyForm.elements.userId.value.trim() ? '' : 'Please provide your User ID.';
    const pwError = legacyForm.elements.password.value ? '' : 'Please provide your password.';

    if (idError) { Forms.setFieldError(legacyForm.elements.userId, idError); firstInvalid = legacyForm.elements.userId; }
    else Forms.clearFieldError(legacyForm.elements.userId);
    if (pwError) { Forms.setFieldError(legacyForm.elements.password, pwError); firstInvalid = firstInvalid || legacyForm.elements.password; }
    else Forms.clearFieldError(legacyForm.elements.password);

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  for (const input of [legacyForm.elements.userId, legacyForm.elements.password]) {
    input.addEventListener('input', () => {
      if (input.closest('.field').classList.contains('has-error')) Forms.clearFieldError(input);
    });
  }

  legacyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (legacySubmitBtn.disabled) return;

    Forms.hideAlert(alertEl);
    Forms.clearAllErrors(legacyForm);
    if (!validateLegacyForm()) return;

    Forms.setLoading(legacySubmitBtn, true, 'Signing in…');
    try {
      await Auth.login({ userId: legacyForm.elements.userId.value, password: legacyForm.elements.password.value });
      window.location.replace(destination());
    } catch (err) {
      Forms.setLoading(legacySubmitBtn, false);
      legacyForm.elements.password.value = '';

      if (!(err instanceof ApiError)) {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
      } else if (err.isNetworkError) {
        Forms.showAlert(alertEl, err.message);
      } else if (err.status === 401) {
        Forms.showAlert(alertEl, err.message);
        legacyForm.elements.password.focus();
      } else if (err.status === 403) {
        Forms.showAlert(alertEl, err.message);
      } else if (err.isRateLimited) {
        Forms.showAlert(alertEl, 'Too many sign-in attempts. Please wait a few minutes and try again.');
      } else if (err.isValidation) {
        const unmatched = Forms.applyServerErrors(legacyForm, err.errors);
        if (unmatched.length || !err.errors.length) Forms.showAlert(alertEl, unmatched.join(' ') || err.message);
      } else {
        Forms.showAlert(alertEl, err.message || 'Something went wrong. Please try again.');
      }
      if (!alertEl.hidden && alertEl.focus) alertEl.focus();
    }
  });
})();
