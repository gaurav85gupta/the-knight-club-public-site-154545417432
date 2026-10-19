/**
 * Change Password controller.
 *
 * MOVED, NOT REWRITTEN: everything below the guard is the original
 * change-password block from the old dashboard.js — same client-side checks
 * (Forms.check.password, must-differ, must-match), same Auth.changePassword()
 * call to the existing endpoint, same error mapping:
 *   INCORRECT_CURRENT_PASSWORD (400) -> shown on the current-password field
 *   422 validation                   -> per-field errors
 *   429                              -> rate-limit message
 *   401/403                          -> Auth.handleSessionError (back to login)
 * A wrong current password is a 400, so it never signs the user out.
 *
 * SECURITY: passwords are only ever read from the form inputs and passed to
 * Auth.changePassword(). They are never logged, stored, put in a URL, or
 * echoed back; the form is reset on success.
 */

(async function initChangePassword() {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  document.documentElement.classList.remove('auth-pending');
  StudentShell.mount({ user, active: 'change-password' });

  // ---- Change password ----------------------------------------------------
  const pwForm = document.getElementById('pw-form');
  const pwAlert = document.getElementById('pw-alert');
  const pwSubmit = document.getElementById('pw-submit');
  Forms.initPasswordToggles(pwForm);

  pwForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pwSubmit.disabled) return;

    Forms.hideAlert(pwAlert);
    Forms.clearAllErrors(pwForm);

    const { currentPassword, newPassword, confirmNewPassword } = pwForm.elements;
    let firstInvalid = null;
    const flag = (input, message) => {
      Forms.setFieldError(input, message);
      firstInvalid = firstInvalid || input;
    };

    if (!currentPassword.value) flag(currentPassword, 'Please provide your current password.');
    const newErr = Forms.check.password(newPassword.value);
    if (newErr) flag(newPassword, newErr);
    else if (newPassword.value === currentPassword.value) flag(newPassword, 'New password must be different from your current password.');
    if (confirmNewPassword.value !== newPassword.value) flag(confirmNewPassword, 'Passwords do not match.');
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    Forms.setLoading(pwSubmit, true, 'Updating…');
    try {
      const result = await Auth.changePassword({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
        confirmNewPassword: confirmNewPassword.value,
      });
      pwForm.reset();
      const others = result && result.otherSessionsSignedOut;
      Forms.showAlert(
        pwAlert,
        others > 0
          ? `Password updated. ${others} other device${others === 1 ? '' : 's'} signed out.`
          : 'Password updated.',
        'success'
      );
    } catch (err) {
      // A real expired session goes back to login. NOTE: a wrong current
      // password is a 400 (INCORRECT_CURRENT_PASSWORD), not a 401, so it never
      // lands here and never logs the user out.
      if (Auth.handleSessionError(err)) return;

      if (!(err instanceof ApiError)) {
        Forms.showAlert(pwAlert, 'Something went wrong. Please try again.');
      } else if (err.errorCode === 'INCORRECT_CURRENT_PASSWORD') {
        Forms.setFieldError(currentPassword, err.message);
        currentPassword.focus();
      } else if (err.isValidation) {
        const unmatched = Forms.applyServerErrors(pwForm, err.errors);
        if (unmatched.length || !err.errors.length) Forms.showAlert(pwAlert, unmatched.join(' ') || err.message);
      } else if (err.isRateLimited) {
        Forms.showAlert(pwAlert, 'Too many attempts. Please wait a few minutes and try again.');
      } else {
        Forms.showAlert(pwAlert, err.message);
      }
    } finally {
      Forms.setLoading(pwSubmit, false);
    }
  });
})();
