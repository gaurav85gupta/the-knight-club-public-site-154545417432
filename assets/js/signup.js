/**
 * Signup page controller.
 *
 * Flow:  client-side checks  ->  POST /auth/register  ->  Sign In face.
 *
 * Registration deliberately does NOT sign the user in (backend design). Both
 * the Sign In and Create Account forms live on the same page (see
 * login.html / signup.html), so on success this flips to the Sign In face
 * in place (via auth-flip.js) and shows an "account created" notice there,
 * rather than navigating. If auth-flip.js is unavailable for any reason,
 * it falls back to the original cross-page notice + navigation to
 * login.html.
 *
 * `confirmPassword` is sent to the server ONLY because the backend validator
 * requires it in order to compare the two values; the backend discards it. It
 * is never kept in JS state, storage or logs here.
 */

(function initSignupPage() {
  const form = document.getElementById('signup-form');
  if (!form) return;

  const alertEl = document.getElementById('form-alert-signup');
  const submitBtn = document.getElementById('signup-submit-btn');

  Forms.initPasswordToggles(form);

  // Already signed in? Skip the signup page.
  Auth.redirectIfAuthenticated();

  // ---- Client-side validation (feedback only; the server re-validates) ----
  const validators = {
    userId: (f) => Forms.check.userId(f.userId.value),
    mobile: (f) => Forms.check.mobile(f.mobile.value),
    password: (f) => Forms.check.password(f.password.value),
    confirmPassword: (f) =>
      f.confirmPassword.value === f.password.value ? '' : 'Passwords do not match.',
    fullName: (f) => {
      const v = f.fullName.value.trim();
      if (v.length < 2) return 'Please provide your full name.';
      if (!/\p{L}/u.test(v)) return 'Please provide your full name.';
      return '';
    },
    dateOfBirth: (f) => {
      const v = f.dateOfBirth.value;
      if (!v) return 'Please provide your date of birth.';
      if (Number.isNaN(Date.parse(v))) return 'Please provide a valid date of birth.';
      return '';
    },
    gender: (f) => (f.gender.value ? '' : 'Please select a gender option.'),
    address: (f) =>
      f.address.value.trim().length >= 5 ? '' : 'Please provide your address.',
    city: (f) => (f.city.value.trim().length >= 2 ? '' : 'Please provide your city.'),
    state: (f) => (f.state.value.trim().length >= 2 ? '' : 'Please provide your state.'),
    pincode: (f) =>
      /^[1-9]\d{5}$/.test(f.pincode.value.trim()) ? '' : 'Please provide a valid 6-digit pincode.',
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
      if (name === 'password' && form.confirmPassword.value) validateField('confirmPassword');
    });
  }

  // The DOB picker must not offer future dates.
  form.dateOfBirth.max = new Date().toISOString().slice(0, 10);

  /**
   * The backend answers a duplicate with 409 and a MESSAGE (not a field
   * name), so route it to the right input by message. Anything not
   * recognised falls through to the banner — never dropped.
   */
  function showConflict(err) {
    const msg = err.message || '';
    if (/user id/i.test(msg)) {
      Forms.setFieldError(form.userId, 'This User ID is already taken. Please choose another.');
      form.userId.focus();
    } else if (/mobile/i.test(msg)) {
      Forms.setFieldError(form.mobile, 'An account with this mobile number already exists. Try signing in instead.');
      form.mobile.focus();
    } else {
      Forms.showAlert(alertEl, msg || 'An account with these details already exists.', 'error');
    }
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
      fullName: form.fullName.value,
      mobile: form.mobile.value,
      userId: form.userId.value,
      password: form.password.value,
      confirmPassword: form.confirmPassword.value,
      dateOfBirth: form.dateOfBirth.value,
      gender: form.gender.value,
      address: form.address.value,
      city: form.city.value,
      state: form.state.value,
      pincode: form.pincode.value,
    };

    Forms.setLoading(submitBtn, true, 'Creating account…');
    try {
      await Auth.register(payload);
      // Both faces live on one page now: flip to Sign In in place instead
      // of a full navigation, and show the success notice right there.
      const loginAlert = document.getElementById('form-alert');
      if (window.AuthFlip && loginAlert) {
        form.reset();
        Forms.setLoading(submitBtn, false);
        window.AuthFlip.setActive('login');
        Forms.showAlert(loginAlert, 'Account created! Sign in with your User ID and password.', 'success');
        loginAlert.focus && loginAlert.focus();
      } else {
        Auth.setNotice('Account created! Sign in with your User ID and password.', 'success');
        window.location.replace('login.html');
      }
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
