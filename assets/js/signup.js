/**
 * Signup page controller (email + password + Google).
 *
 * Flow:  client-side checks  ->  POST /auth/register-email  ->  "check your
 *        email" message in place of the form (account is created but
 *        UNVERIFIED — the student cannot sign in until they click the
 *        emailed link; see verify-email.html).
 *
 * Google: GoogleSignIn.render() wires the button; a successful Google
 * sign-in signs the student in immediately (Google already verifies the
 * email) and redirects straight to the dashboard or the profile-completion
 * step — see the onSuccess callback below.
 *
 * `confirmPassword` is sent to the server ONLY because the backend validator
 * requires it to compare the two values; it is never kept in JS state,
 * storage or logs here.
 */

(function initSignupPage() {
  const form = document.getElementById('signup-form');
  if (!form) return;

  const alertEl = document.getElementById('form-alert-signup');
  const submitBtn = document.getElementById('signup-submit-btn');
  const cardSection = document.getElementById('auth-face-signup');

  Forms.initPasswordToggles(form);

  // Already signed in? Skip the signup page.
  Auth.redirectIfAuthenticated();

  // ---- Google Sign-In ------------------------------------------------------
  GoogleSignIn.render({
    container: document.getElementById('google-signup-btn'),
    onStart: () => Forms.hideAlert(alertEl),
    onSuccess: (user, isNewAccount) => {
      if (isNewAccount && user.needsProfileCompletion) {
        window.location.replace('complete-profile.html');
      } else {
        window.location.replace(Auth.safeNext(new URLSearchParams(window.location.search).get('next')));
      }
    },
    onError: (message) => Forms.showAlert(alertEl, message),
  });

  // ---- Client-side validation (feedback only; the server re-validates) ----
  const validators = {
    fullName: (f) => {
      const v = f.fullName.value.trim();
      if (v.length < 2) return 'Please provide your full name.';
      if (!/\p{L}/u.test(v)) return 'Please provide your full name.';
      return '';
    },
    email: (f) => Forms.check.email(f.email.value),
    mobile: (f) => Forms.check.mobile(f.mobile.value),
    state: (f) => (f.state.value.trim().length >= 2 ? '' : 'Please provide your state.'),
    password: (f) => Forms.check.password(f.password.value),
    confirmPassword: (f) =>
      f.confirmPassword.value === f.password.value ? '' : 'Passwords do not match.',
  };

  /** Validates one field. Returns true when valid. */
  function validateField(name) {
    const input = form.elements[name];
    const message = validators[name](form.elements);
    if (message) Forms.setFieldError(input, message);
    else Forms.clearFieldError(input);
    return !message;
  }

  /** Validates every field; focuses the first invalid one. */
  function validateAll() {
    let firstInvalid = null;
    for (const name of Object.keys(validators)) {
      if (!validateField(name) && !firstInvalid) firstInvalid = form.elements[name];
    }
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  // Validate a field when the user leaves it; clear its error as they fix it.
  for (const name of Object.keys(validators)) {
    const input = form.elements[name];
    input.addEventListener('blur', () => {
      if (input.value !== '') validateField(name);
    });
    input.addEventListener('input', () => {
      if (input.closest('.field').classList.contains('has-error')) validateField(name);
      // Editing password changes whether the confirmation matches.
      if (name === 'password' && form.elements.confirmPassword.value) validateField('confirmPassword');
    });
  }

  /**
   * The backend answers a duplicate with 409 and a MESSAGE (not a field
   * name), so route it to the right input by message. Anything not
   * recognised falls through to the banner — never dropped.
   */
  function showConflict(err) {
    const msg = err.message || '';
    if (/email/i.test(msg)) {
      Forms.setFieldError(form.elements.email, 'An account with this email already exists. Try signing in instead.');
      form.elements.email.focus();
    } else if (/mobile/i.test(msg)) {
      Forms.setFieldError(form.elements.mobile, 'An account with this mobile number already exists. Try signing in instead.');
      form.elements.mobile.focus();
    } else {
      Forms.showAlert(alertEl, msg || 'An account with these details already exists.', 'error');
    }
  }

  /**
   * Replaces the form with a "check your email" confirmation — the account
   * exists but cannot sign in until the emailed link is clicked. This
   * mirrors how the original flow flipped to the Sign In face in place,
   * but here there is nowhere useful to flip TO (signing in would just
   * fail as unverified), so a static confirmation is clearer.
   */
  function showCheckEmail(email) {
    cardSection.innerHTML = `
      <div class="auth-status">
        <div class="auth-status-icon auth-status-icon--pending" aria-hidden="true">&#9993;</div>
        <h1>Check your email</h1>
        <p class="lead">We've sent a verification link to <strong>${Forms.escapeForHtml(email)}</strong>.
        Click the link to activate your account, then sign in.</p>
      </div>
      <p class="auth-alt"><a href="login.html">Go to sign in</a></p>
    `;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return; // guards double-submit (Enter key + click)

    Forms.hideAlert(alertEl);
    Forms.clearAllErrors(form);
    if (!validateAll()) return;

    // Explicit allow-list of what we send — never `Object.fromEntries(new FormData(form))`,
    // so a stray or injected form control can't ride along.
    const payload = {
      fullName: form.elements.fullName.value,
      email: form.elements.email.value,
      mobile: form.elements.mobile.value,
      state: form.elements.state.value,
      password: form.elements.password.value,
      confirmPassword: form.elements.confirmPassword.value,
    };

    Forms.setLoading(submitBtn, true, 'Creating account…');
    try {
      const user = await Auth.registerWithEmail(payload);
      showCheckEmail(user.email);
    } catch (err) {
      Forms.setLoading(submitBtn, false);
      if (!(err instanceof ApiError)) {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
        return;
      }
      if (err.isNetworkError) {
        Forms.showAlert(alertEl, err.message);
      } else if (err.status === 409) {
        showConflict(err);
      } else if (err.isValidation) {
        const unmatched = Forms.applyServerErrors(form, err.errors);
        if (unmatched.length) Forms.showAlert(alertEl, unmatched.join(' '));
        else if (!err.errors.length) Forms.showAlert(alertEl, err.message);
      } else if (err.isRateLimited) {
        Forms.showAlert(alertEl, 'Too many sign-up attempts. Please wait a while and try again.');
      } else {
        Forms.showAlert(alertEl, err.message || 'Something went wrong. Please try again.');
      }
    }
  });
})();
