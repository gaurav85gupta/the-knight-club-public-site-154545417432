/**
 * Forgot-password page controller.
 *
 * ENUMERATION RESISTANCE: this page shows the SAME success message after
 * submit, whether or not the email is registered — mirroring the backend's
 * contract (see auth.service.requestPasswordReset / GENERIC_EMAIL_ACTION_MESSAGE).
 * This file must never branch UI behavior on whether the account exists;
 * there is no such information available to it in the first place, by
 * design.
 */

(function initForgotPasswordPage() {
  const form = document.getElementById('forgot-password-form');
  if (!form) return;

  const alertEl = document.getElementById('form-alert-forgot');
  const submitBtn = document.getElementById('forgot-submit-btn');
  const section = document.getElementById('auth-face-forgot');

  form.elements.email.addEventListener('input', () => {
    if (form.elements.email.closest('.field').classList.contains('has-error')) {
      Forms.clearFieldError(form.elements.email);
    }
  });

  function showSent(email) {
    section.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'auth-status';

    const icon = document.createElement('div');
    icon.className = 'auth-status-icon auth-status-icon--pending';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u2709';

    const h1 = document.createElement('h1');
    h1.textContent = 'Check your email';

    const p = document.createElement('p');
    p.className = 'lead';
    p.textContent = `If an account exists for ${email}, we've sent a link to reset your password. The link expires in 30 minutes.`;

    wrap.append(icon, h1, p);
    section.appendChild(wrap);

    const alt = document.createElement('p');
    alt.className = 'auth-alt';
    const link = document.createElement('a');
    link.href = 'login.html';
    link.textContent = 'Back to sign in';
    alt.appendChild(link);
    section.appendChild(alt);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;

    Forms.hideAlert(alertEl);
    Forms.clearAllErrors(form);

    const emailError = Forms.check.email(form.elements.email.value);
    if (emailError) {
      Forms.setFieldError(form.elements.email, emailError);
      form.elements.email.focus();
      return;
    }

    const email = form.elements.email.value;

    Forms.setLoading(submitBtn, true, 'Sending…');
    try {
      await Auth.forgotPassword(email);
      // Always the generic confirmation — see the enumeration-resistance
      // note at the top of this file. There is no success/failure branch.
      showSent(email);
    } catch (err) {
      Forms.setLoading(submitBtn, false);
      // Only transport-level failures (network/timeout) or rate-limiting
      // reach here — the backend never answers this endpoint with an
      // account-specific error (see auth.controller.forgotPassword).
      if (err instanceof ApiError && err.isNetworkError) {
        Forms.showAlert(alertEl, err.message);
      } else if (err instanceof ApiError && err.isRateLimited) {
        Forms.showAlert(alertEl, 'Too many requests. Please wait a while and try again.');
      } else if (err instanceof ApiError && err.isValidation) {
        const unmatched = Forms.applyServerErrors(form, err.errors);
        if (unmatched.length || !err.errors.length) Forms.showAlert(alertEl, unmatched.join(' ') || err.message);
      } else {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
      }
    }
  });
})();
