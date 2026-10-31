/**
 * Google Sign-In button wiring (Google Identity Services).
 *
 * WHAT THIS FILE DOES
 * Loads Google's gsi/client script, renders a "Sign in with Google" button
 * into a page-provided container, and on success hands the raw ID token
 * straight to Auth.googleAuth() — never touching cookies, tokens, or our
 * own session directly. Auth.js remains the single owner of "who is signed
 * in"; this file's only job is obtaining the Google credential and handing
 * it off.
 *
 * TRUST: the ID token is NOT trusted here. It is a signed JWT from Google
 * that only the BACKEND verifies (see services/googleAuth.service.js). This
 * file forwards it over HTTPS and never inspects or decodes its payload.
 *
 * CONFIG: GOOGLE_CLIENT_ID is public by design (it identifies the app, not
 * a secret — the matching secret never leaves the backend) and is read from
 * CONFIG, mirroring how config.js centralizes API_BASE_URL.
 */

const GoogleSignIn = (() => {
  const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
  let scriptLoadPromise = null;

  function loadScript() {
    if (scriptLoadPromise) return scriptLoadPromise;
    scriptLoadPromise = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load Google Sign-In. Please check your connection.'));
      document.head.appendChild(script);
    });
    return scriptLoadPromise;
  }

  /**
   * Renders a Google Sign-In button into `container` and wires it end to
   * end: click -> Google credential -> Auth.googleAuth() -> onSuccess(user, isNewAccount).
   *
   * @param {object} opts
   * @param {HTMLElement} opts.container   element to render the button into
   * @param {(user: object, isNewAccount: boolean) => void} opts.onSuccess
   * @param {(message: string) => void} opts.onError
   * @param {() => void} [opts.onStart]    called right before the backend call, so the page can show a loading state
   */
  async function render({ container, onSuccess, onError, onStart }) {
    if (!container) return;
    if (!CONFIG.GOOGLE_CLIENT_ID) {
      // Configuration gap (e.g. this frontend deployed before the backend's
      // Google credentials are set) — fail quietly rather than show a
      // broken button. The rest of the page (email/password) still works.
      container.hidden = true;
      return;
    }

    try {
      await loadScript();
    } catch (err) {
      container.hidden = true;
      if (onError) onError(err.message);
      return;
    }

    window.google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: async (response) => {
        try {
          if (onStart) onStart();
          const { user, isNewAccount } = await Auth.googleAuth(response.credential);
          if (onSuccess) onSuccess(user, isNewAccount);
        } catch (err) {
          const message =
            err instanceof ApiError
              ? err.message
              : 'Could not sign in with Google. Please try again.';
          if (onError) onError(message);
        }
      },
      // 'none' avoids the One Tap auto-prompt popping up unasked on a page
      // the student may have only glanced at; the explicit button below is
      // the only way this flow starts.
      auto_select: false,
      itp_support: true,
    });

    window.google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: container.clientWidth || 320,
    });
  }

  return { render };
})();
