/**
 * Complete-profile page controller.
 *
 * Reached only by a brand-new Google-Sign-In account (mobile/state not yet
 * collected — see Student.toSafeStudent().needsProfileCompletion, set by
 * signup.js / login.js right after Auth.googleAuth() resolves).
 *
 * Authenticated: Auth.requireAuth() redirects to login.html if there is no
 * valid session, exactly like any other protected page in this app
 * (dashboard, profile, etc.) — this page is not reachable by an
 * unauthenticated visitor just by typing the URL.
 *
 * If the student's profile is ALREADY complete (e.g. they navigate back
 * here manually after finishing it), this page redirects straight to the
 * dashboard rather than showing the form again.
 */

(function initCompleteProfilePage() {
  const form = document.getElementById('complete-profile-form');
  if (!form) return;

  const alertEl = document.getElementById('form-alert-complete');
  const submitBtn = document.getElementById('complete-submit-btn');

  Auth.requireAuth().then((user) => {
    if (!user.needsProfileCompletion) {
      window.location.replace(Auth.urlFor(Auth.PATHS.dashboard));
    }
  });

  form.elements.mobile.addEventListener('input', () => {
    if (form.elements.mobile.closest('.field').classList.contains('has-error')) Forms.clearFieldError(form.elements.mobile);
  });
  form.elements.state.addEventListener('input', () => {
    if (form.elements.state.closest('.field').classList.contains('has-error')) Forms.clearFieldError(form.elements.state);
  });

  function validate() {
    let firstInvalid = null;
    const mobileError = Forms.check.mobile(form.elements.mobile.value);
    const stateError = form.elements.state.value.trim().length >= 2 ? '' : 'Please provide your state.';

    if (mobileError) { Forms.setFieldError(form.elements.mobile, mobileError); firstInvalid = form.elements.mobile; }
    else Forms.clearFieldError(form.elements.mobile);
    if (stateError) { Forms.setFieldError(form.elements.state, stateError); firstInvalid = firstInvalid || form.elements.state; }
    else Forms.clearFieldError(form.elements.state);

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;

    Forms.hideAlert(alertEl);
    Forms.clearAllErrors(form);
    if (!validate()) return;

    Forms.setLoading(submitBtn, true, 'Saving…');
    try {
      await Auth.completeProfile({ mobile: form.elements.mobile.value, state: form.elements.state.value });
      window.location.replace(Auth.urlFor(Auth.PATHS.dashboard));
    } catch (err) {
      Forms.setLoading(submitBtn, false);

      if (!(err instanceof ApiError)) {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
      } else if (err.isNetworkError) {
        Forms.showAlert(alertEl, err.message);
      } else if (err.status === 409) {
        Forms.setFieldError(form.elements.mobile, err.message);
        form.elements.mobile.focus();
      } else if (err.isRateLimited) {
        Forms.showAlert(alertEl, 'Too many attempts. Please wait a while and try again.');
      } else if (err.isValidation) {
        const unmatched = Forms.applyServerErrors(form, err.errors);
        if (unmatched.length || !err.errors.length) Forms.showAlert(alertEl, unmatched.join(' ') || err.message);
      } else {
        Forms.showAlert(alertEl, err.message || 'Something went wrong. Please try again.');
      }
    }
  });
})();
