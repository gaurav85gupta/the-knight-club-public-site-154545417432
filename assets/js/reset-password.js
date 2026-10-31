/**
 * Reset-password page controller.
 *
 * Reads `?token=` from this page's own URL (same link-emailed-by-backend
 * pattern as verify-email.js). If the token is missing entirely, the form
 * is replaced with an error up front — there is nothing a form submission
 * could do without one. A token that turns out to be invalid/expired is
 * only discovered on submit (the backend is the source of truth; this page
 * never tries to pre-validate the token itself).
 *
 * On success: redirects to login.html with a one-shot success notice. Does
 * NOT sign the student in automatically — mirrors the backend
 * (resetPassword revokes every existing session; signing in fresh after
 * is the correct next step, not an automatic one).
 */

(function initResetPasswordPage() {
  const form = document.getElementById('reset-password-form');
  if (!form) return;

  const alertEl = document.getElementById('form-alert-reset');
  const submitBtn = document.getElementById('reset-submit-btn');
  const section = document.getElementById('auth-face-reset');

  Forms.initPasswordToggles(form);

  const token = new URLSearchParams(window.location.search).get('token');
  if (!token) {
    section.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'auth-status';
    const icon = document.createElement('div');
    icon.className = 'auth-status-icon auth-status-icon--error';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '!';
    const h1 = document.createElement('h1');
    h1.textContent = 'Invalid link';
    const p = document.createElement('p');
    p.className = 'lead';
    p.textContent = 'This reset link is missing its token. Please use the link from your email exactly as sent, or request a new one.';
    wrap.append(icon, h1, p);
    section.appendChild(wrap);

    const alt = document.createElement('p');
    alt.className = 'auth-alt';
    const link = document.createElement('a');
    link.href = 'forgot-password.html';
    link.textContent = 'Request a new link';
    alt.appendChild(link);
    section.appendChild(alt);
    return;
  }

  function validate() {
    let firstInvalid = null;
    const pwError = Forms.check.password(form.elements.newPassword.value);
    const confirmError =
      form.elements.confirmNewPassword.value === form.elements.newPassword.value ? '' : 'Passwords do not match.';

    if (pwError) { Forms.setFieldError(form.elements.newPassword, pwError); firstInvalid = form.elements.newPassword; }
    else Forms.clearFieldError(form.elements.newPassword);
    if (confirmError) { Forms.setFieldError(form.elements.confirmNewPassword, confirmError); firstInvalid = firstInvalid || form.elements.confirmNewPassword; }
    else Forms.clearFieldError(form.elements.confirmNewPassword);

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  for (const name of ['newPassword', 'confirmNewPassword']) {
    form.elements[name].addEventListener('input', () => {
      if (form.elements[name].closest('.field').classList.contains('has-error')) {
        Forms.clearFieldError(form.elements[name]);
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;

    Forms.hideAlert(alertEl);
    Forms.clearAllErrors(form);
    if (!validate()) return;

    Forms.setLoading(submitBtn, true, 'Resetting…');
    try {
      await Auth.resetPassword({
        token,
        newPassword: form.elements.newPassword.value,
        confirmNewPassword: form.elements.confirmNewPassword.value,
      });
      Auth.setNotice('Password reset successfully. Please sign in with your new password.', 'success');
      window.location.replace('login.html');
    } catch (err) {
      Forms.setLoading(submitBtn, false);
      form.elements.newPassword.value = '';
      form.elements.confirmNewPassword.value = '';

      if (!(err instanceof ApiError)) {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
      } else if (err.isNetworkError) {
        Forms.showAlert(alertEl, err.message);
      } else if (err.status === 400) {
        // Invalid/expired token — the backend's message already says so.
        Forms.showAlert(alertEl, err.message);
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
