/**
 * Verify-email page controller.
 *
 * Reads `?token=` from this page's own URL (the link emailed by the
 * backend — see email.service.js) and fires the verification call
 * automatically on load. The student's only action is clicking the link
 * in their inbox; everything from there is automatic, matching the
 * "professional, one-click" verification flow agreed on for this product.
 *
 * Does NOT sign the student in (see auth.service.verifyEmail's doc comment
 * on the backend: verifying proves control of the inbox, not the
 * password). On success this page sends them to login.html with a
 * one-shot success notice; Auth.login/Auth.loginWithEmail happens there.
 */

(function initVerifyEmailPage() {
  const section = document.getElementById('auth-face-verify');
  if (!section) return;

  function renderError(message) {
    section.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'auth-status';

    const icon = document.createElement('div');
    icon.className = 'auth-status-icon auth-status-icon--error';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '!';

    const h1 = document.createElement('h1');
    h1.textContent = 'Verification failed';

    const p = document.createElement('p');
    p.className = 'lead';
    p.textContent = message;

    wrap.append(icon, h1, p);
    section.appendChild(wrap);

    const alt = document.createElement('p');
    alt.className = 'auth-alt';
    const link = document.createElement('a');
    link.href = 'login.html';
    link.textContent = 'Go to sign in';
    alt.appendChild(link);
    section.appendChild(alt);
  }

  function renderSuccessAndRedirect() {
    section.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'auth-status';

    const icon = document.createElement('div');
    icon.className = 'auth-status-icon auth-status-icon--success';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u2713';

    const h1 = document.createElement('h1');
    h1.textContent = 'Email verified';

    const p = document.createElement('p');
    p.className = 'lead';
    p.textContent = 'Your account is now active. Redirecting you to sign in…';

    wrap.append(icon, h1, p);
    section.appendChild(wrap);

    Auth.setNotice('Email verified. You can now sign in.', 'success');
    window.setTimeout(() => {
      window.location.replace('login.html');
    }, 1500);
  }

  const token = new URLSearchParams(window.location.search).get('token');
  if (!token) {
    renderError('This verification link is missing its token. Please use the link from your email exactly as sent.');
    return;
  }

  Auth.verifyEmail(token)
    .then(() => renderSuccessAndRedirect())
    .catch((err) => {
      const message =
        err instanceof ApiError && !err.isNetworkError
          ? err.message
          : 'This verification link is invalid or has expired. Please request a new one by trying to sign in.';
      renderError(message);
    });
})();
