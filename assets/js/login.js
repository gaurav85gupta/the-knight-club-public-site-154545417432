/**
 * Login page controller.
 *
 * Flow:  validate  ->  Auth.login (POST /auth/login)  ->  profile loaded
 *        ->  redirect to ?next (validated) or the dashboard.
 *
 * ERROR HANDLING MAP (what the backend can answer, and what the user sees)
 *   401  wrong User ID or password  -> the backend's generic message, shown
 *                                      in the banner (NOT beside a single
 *                                      field, which would hint which one was wrong)
 *   403  suspended account          -> controlled message from the backend
 *   429  rate limited               -> "too many attempts" message
 *   0    network / timeout          -> connection message
 *   422  malformed input            -> field errors
 *
 * The form keeps the User ID after a failed attempt but always clears the
 * password field, so a shoulder-surfer or shared computer doesn't inherit it.
 */

(function initLoginPage() {
  const form = document.getElementById('login-form');
  if (!form) return;

  const alertEl = document.getElementById('form-alert');
  const submitBtn = form.querySelector('#submit-btn');

  Forms.initPasswordToggles(form);

  // One-shot notice from the signup page or a session-expiry redirect.
  const notice = Auth.consumeNotice();
  if (notice) Forms.showAlert(alertEl, notice.message, notice.kind === 'success' ? 'success' : notice.kind === 'error' ? 'error' : 'info');

  // Already signed in? Go straight on (also honours ?next).
  const params = new URLSearchParams(window.location.search);
  const destination = () => Auth.safeNext(params.get('next'));

  Auth.init().then((user) => {
    if (user) window.location.replace(destination());
  });

  function validate() {
    let firstInvalid = null;
    const idError = form.userId.value.trim() ? '' : 'Please provide your User ID.';
    const pwError = form.password.value ? '' : 'Please provide your password.';

    if (idError) { Forms.setFieldError(form.userId, idError); firstInvalid = form.userId; } else Forms.clearFieldError(form.userId);
    if (pwError) { Forms.setFieldError(form.password, pwError); firstInvalid = firstInvalid || form.password; } else Forms.clearFieldError(form.password);

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  for (const input of [form.userId, form.password]) {
    input.addEventListener('input', () => {
      if (input.closest('.field').classList.contains('has-error')) Forms.clearFieldError(input);
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;

    Forms.hideAlert(alertEl);
    Forms.clearAllErrors(form);
    if (!validate()) return;

    Forms.setLoading(submitBtn, true, 'Signing in…');
    try {
      await Auth.login({ userId: form.userId.value, password: form.password.value });
      window.location.replace(destination());
      // Leave the button in its loading state: we are navigating away.
    } catch (err) {
      Forms.setLoading(submitBtn, false);
      form.password.value = '';

      if (!(err instanceof ApiError)) {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
      } else if (err.isNetworkError) {
        Forms.showAlert(alertEl, err.message);
      } else if (err.status === 401) {
        // Backend's generic message ("Invalid User ID or password."). Deliberately
        // NOT attached to either field: pointing at one would leak which was wrong.
        Forms.showAlert(alertEl, err.message);
        form.password.focus();
      } else if (err.status === 403) {
        Forms.showAlert(alertEl, err.message);
      } else if (err.isRateLimited) {
        Forms.showAlert(alertEl, 'Too many sign-in attempts. Please wait a few minutes and try again.');
      } else if (err.isValidation) {
        const unmatched = Forms.applyServerErrors(form, err.errors);
        if (unmatched.length || !err.errors.length) Forms.showAlert(alertEl, unmatched.join(' ') || err.message);
      } else {
        Forms.showAlert(alertEl, err.message || 'Something went wrong. Please try again.');
      }
      if (!alertEl.hidden) alertEl.focus && alertEl.focus();
    }
  });
})();
