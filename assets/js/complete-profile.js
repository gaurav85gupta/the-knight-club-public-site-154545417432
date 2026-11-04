/**
 * Complete-profile page controller.
 *
 * Reached by TWO different callers, handled differently here because only
 * one of them has a session:
 *
 *  1. BRAND-NEW Google signup (the normal case after the ghost-account
 *     fix). No Student row exists yet — see auth.service.js's
 *     googleAuthenticate()/completeNewGoogleSignup() — so there is no
 *     session to fetch via /auth/me, and Auth.requireAuth() would wrongly
 *     bounce this visitor to the login page. Authorization for this case
 *     comes entirely from the short-lived `tnc_pgs` pending-signup cookie
 *     the server set right after Google verification; the browser sends it
 *     automatically with the submit below. The name/email shown here are
 *     read once from Auth.consumePendingSignupPreview() (sessionStorage —
 *     see signup.js/login.js), purely for display; nothing server-side
 *     trusts them. If this visitor never submits the form, that cookie
 *     simply expires in 15 minutes and no account was ever created.
 *
 *  2. An EXISTING account from before this fix whose profile is still
 *     incomplete (no mobile/state) — it already has a normal session.
 *     This path still uses Auth.requireAuth() exactly as before, so an
 *     already-existing incomplete account keeps working unchanged.
 *
 * Auth.completeProfile() (see auth.js) submits to the same endpoint either
 * way; the SERVER tells the two cases apart by cookie and responds with
 * `isNewAccount` so this page knows whether an account was just created
 * (case 1) or merely updated (case 2) — see the submit handler below.
 */

(function initCompleteProfilePage() {
  const form = document.getElementById('complete-profile-form');
  if (!form) return;

  const alertEl = document.getElementById('form-alert-complete');
  const submitBtn = document.getElementById('complete-submit-btn');

  const pendingPreview = Auth.consumePendingSignupPreview();

  if (pendingPreview) {
    // Case 1: brand-new signup, no session to check. Pre-fill with the
    // name Google gave us; the student can edit it if it's wrong,
    // incomplete, or a nickname. Nothing to redirect on here — if the
    // pending-signup cookie has already expired, the submit below will
    // surface that as a normal 401 from the server.
    if (pendingPreview.fullName) form.elements.fullName.value = pendingPreview.fullName;
  } else {
    // Case 2: no pending-signup preview in this tab, so this must be an
    // already-existing incomplete account reached with a real session —
    // fall back to the original authenticated flow.
    Auth.requireAuth().then((user) => {
      if (!user.needsProfileCompletion) {
        window.location.replace(Auth.urlFor(Auth.PATHS.dashboard));
        return;
      }
      if (user.fullName) form.elements.fullName.value = user.fullName;
    });
  }

  // Digit-only guard: strips anything that isn't 0-9 as the student types
  // or pastes, in addition to the maxlength="10" on the input itself.
  form.elements.mobile.addEventListener('input', () => {
    const digitsOnly = form.elements.mobile.value.replace(/\D/g, '').slice(0, 10);
    if (digitsOnly !== form.elements.mobile.value) form.elements.mobile.value = digitsOnly;
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
      await Auth.completeProfile({
        fullName: form.elements.fullName.value,
        mobile: form.elements.mobile.value,
        state: form.elements.state.value,
      });
      window.location.replace(Auth.urlFor(Auth.PATHS.dashboard));
    } catch (err) {
      Forms.setLoading(submitBtn, false);

      if (!(err instanceof ApiError)) {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
      } else if (err.isNetworkError) {
        Forms.showAlert(alertEl, err.message);
      } else if (err.status === 401) {
        // Either the pending-signup cookie expired (brand-new signup took
        // too long to finish this form — 15 min) or an existing session
        // expired. Either way there is nothing to resume: send them back
        // to start cleanly, exactly like any other expired-session case.
        Auth.setNotice('Your sign-up session has expired. Please sign in with Google again.', 'info');
        window.location.replace(pendingPreview ? 'signup.html' : Auth.urlFor(Auth.PATHS.login));
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
