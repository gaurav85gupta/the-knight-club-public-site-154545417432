/**
 * Auth — the single owner of "who is signed in" on the public website.
 *
 * PAGES NEVER TALK TO THE AUTH ENDPOINTS DIRECTLY. They call this module.
 * That keeps every authentication rule in one file instead of being
 * re-implemented (and subtly diverging) on each HTML page.
 *
 * WHAT IS — AND IS NOT — STORED IN THE BROWSER
 * --------------------------------------------
 * The real credentials are two HttpOnly cookies set by the backend. This
 * file cannot read them and never tries to. There is NO token in
 * localStorage, sessionStorage, a JS variable, or a URL.
 *
 * The only thing persisted client-side is a boolean-ish HINT in
 * localStorage (`tnc_signed_in = '1'`) used purely so a page can decide
 * whether to bother asking the server. It grants nothing: the server is the
 * only authority on whether a request is authenticated. Deleting, forging
 * or copying the hint cannot give access to anything — a protected page
 * still calls GET /auth/me, and the backend answers 401 without a valid
 * cookie. The user profile itself is held in memory only and re-fetched
 * from the server on each page load.
 *
 * PROTECTED PAGES
 * ---------------
 * `Auth.requireAuth()` is the guard. It asks the SERVER (GET /auth/me,
 * with one silent refresh attempt handled by Api) and redirects to the login
 * page when the answer is 401. Hiding UI is never the protection; the
 * backend authorizing each API call is. This guard only decides which page
 * the visitor sees.
 *
 * SESSION EXPIRY
 * --------------
 * If a session dies while the page is open (expired, revoked on another
 * device, account suspended), the next protected API call fails 401 after a
 * failed refresh. Callers pass that error to `Auth.handleSessionError()`,
 * which clears local state and sends the user to the login page with a
 * "session expired" notice.
 *
 * CROSS-TAB SYNC
 * --------------
 * Signing out in one tab must sign out the others. The hint key change is
 * broadcast through the `storage` event; other tabs react by re-checking or
 * redirecting.
 */

const Auth = (() => {
  const HINT_KEY = 'tnc_signed_in';
  const NOTICE_KEY = 'tnc_auth_notice'; // one-shot message shown on the login page

  // Page paths, relative to the site root. Centralized so a rename is one edit.
  const PATHS = Object.freeze({
    login: 'pages/login.html',
    signup: 'pages/signup.html',
    dashboard: 'pages/dashboard.html',
    learning: 'pages/learning.html',
    orders: 'pages/orders.html',
    profile: 'pages/profile.html',
    settings: 'pages/settings.html',
    home: 'index.html',
  });

  /** In-memory only. Never persisted. */
  let currentUser = null;
  let bootstrapped = false;
  const listeners = new Set();

  // ---- small helpers ------------------------------------------------------

  /** Resolves a site-root-relative path from any page depth (root or /pages/). */
  function urlFor(path) {
    const inPages = window.location.pathname.includes('/pages/');
    return (inPages ? '../' : '') + path;
  }

  function setHint(on) {
    try {
      if (on) localStorage.setItem(HINT_KEY, '1');
      else localStorage.removeItem(HINT_KEY);
    } catch {
      /* storage disabled (private mode): the hint is optional */
    }
  }

  function emit() {
    for (const fn of listeners) {
      try {
        fn(currentUser);
      } catch {
        /* a broken listener must not break auth */
      }
    }
  }

  function setUser(user) {
    currentUser = user || null;
    setHint(Boolean(currentUser));
    emit();
  }

  /** Stores a one-shot notice for the next page (e.g. login) to display. */
  function setNotice(message, kind = 'info') {
    try {
      sessionStorage.setItem(NOTICE_KEY, JSON.stringify({ message, kind }));
    } catch {
      /* ignore */
    }
  }

  /** Reads and clears the one-shot notice. */
  function consumeNotice() {
    try {
      const raw = sessionStorage.getItem(NOTICE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(NOTICE_KEY);
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ---- public API ---------------------------------------------------------

  /**
   * Asks the server who the current user is. Populates in-memory state.
   * A 401 is the NORMAL answer for a logged-out visitor, so it resolves to
   * null rather than throwing. Only unexpected failures (network, 5xx)
   * propagate.
   * @returns {Promise<object|null>}
   */
  async function fetchCurrentUser() {
    try {
      const data = await Api.get('/auth/me');
      setUser(data.user);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        // 403 here means a suspended account: treat as signed out locally.
        setUser(null);
      } else {
        throw err;
      }
    }
    bootstrapped = true;
    return currentUser;
  }

  /**
   * Determines initial state once per page load. Cheap when the hint says
   * "logged out" — a first-time visitor triggers no network call.
   */
  async function init() {
    if (bootstrapped) return currentUser;
    let hinted = false;
    try {
      hinted = localStorage.getItem(HINT_KEY) === '1';
    } catch {
      hinted = true; // can't read the hint: ask the server to be safe
    }
    if (!hinted) {
      bootstrapped = true;
      return null;
    }
    try {
      return await fetchCurrentUser();
    } catch {
      // Server unreachable: don't claim a signed-in state we can't verify.
      bootstrapped = true;
      return null;
    }
  }

  /** @returns {object|null} the in-memory user (call init()/requireAuth() first). */
  function getUser() {
    return currentUser;
  }

  function isAuthenticated() {
    return currentUser !== null;
  }

  /**
   * Registers a student. Does NOT sign them in (the backend deliberately
   * separates account creation from session creation).
   * @returns {Promise<object>} the safe user profile
   */
  async function register(fields) {
    const data = await Api.post('/auth/register', fields);
    return data.user;
  }

  /** Signs in with User ID + password, then loads the profile. */
  async function login({ userId, password }) {
    const data = await Api.post('/auth/login', { userId, password });
    setUser(data.user);
    bootstrapped = true;
    return data.user;
  }

  /**
   * Signs out. Local state is cleared even if the network call fails, so the
   * UI never keeps showing a signed-in state the user asked to leave. The
   * server call is what actually revokes the session.
   */
  async function logout() {
    try {
      await Api.post('/auth/logout');
    } catch {
      /* best effort: local state is cleared regardless */
    }
    setUser(null);
  }

  /** Changes the password. The backend keeps THIS session and signs out others. */
  async function changePassword({ currentPassword, newPassword, confirmNewPassword }) {
    return Api.post('/auth/change-password', { currentPassword, newPassword, confirmNewPassword });
  }

  /**
   * Route guard for protected pages. Call at the top of the page script:
   *
   *     const user = await Auth.requireAuth();   // redirects if not signed in
   *
   * Resolves with the user when authenticated. When not, it redirects and
   * returns a promise that never settles, so the page code after the
   * `await` cannot run and briefly render protected UI.
   */
  async function requireAuth() {
    let user = null;
    try {
      user = await fetchCurrentUser();
    } catch {
      // Could not verify (network/5xx). Fail closed: do not show protected UI.
      setNotice('We could not verify your session. Please sign in again.', 'error');
    }
    if (user) return user;

    const next = window.location.pathname + window.location.search;
    window.location.replace(`${urlFor(PATHS.login)}?next=${encodeURIComponent(next)}`);
    return new Promise(() => {});
  }

  /**
   * For login/signup pages: if already signed in, skip them.
   * @returns {Promise<boolean>} true when a redirect was started
   */
  async function redirectIfAuthenticated() {
    const user = await init();
    if (user) {
      window.location.replace(urlFor(PATHS.dashboard));
      return true;
    }
    return false;
  }

  /**
   * Call when a protected API request fails with 401 after Api's refresh
   * attempt: the session is gone. Clears state and returns to login.
   * @returns {boolean} true if it handled the error
   */
  function handleSessionError(err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      setUser(null);
      setNotice(
        err.status === 403
          ? 'This account is currently unavailable. Please contact support.'
          : 'Your session has expired. Please sign in again.',
        'error'
      );
      window.location.replace(urlFor(PATHS.login));
      return true;
    }
    return false;
  }

  /**
   * Validates a post-login redirect target. ONLY same-site, relative paths
   * are honoured — otherwise `?next=https://evil.example` would turn the login
   * page into an open redirector for phishing.
   * @returns {string} a safe URL to navigate to
   */
  function safeNext(candidate) {
    const fallback = urlFor(PATHS.dashboard);
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 300) return fallback;
    // Must be a single-slash absolute path. Reject "//host", "/\host", schemes, and control chars.
    if (!/^\/(?![\/\\])[^\s\u0000-\u001f]*$/.test(candidate)) return fallback;
    return candidate;
  }

  /** Subscribe to auth changes. Returns an unsubscribe function. */
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * Guards a protected page against the browser's back-forward cache
   * (bfcache). `Cache-Control: no-cache` (see serve-static.js) still makes
   * the browser REVALIDATE the HTML document on a normal reload, but a
   * "back" navigation onto a bfcache-eligible page can restore the fully
   * rendered DOM — profile data and all — straight from memory, with NO
   * network request at all. `Cache-Control` cannot prevent that; it only
   * governs the HTTP cache, not bfcache (spec 30, 71).
   *
   * The `pageshow` event fires on every navigation TO this page, including
   * a bfcache restore, and its `persisted` flag is true only for the
   * restore case. On that path we re-verify with the server exactly as
   * requireAuth() does on first load, rather than trusting the frozen DOM.
   * Call this once, after `requireAuth()` has resolved on a protected page.
   */
  function guardBfcache() {
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return; // a normal load already re-ran requireAuth()
      // Hide the frozen (already-rendered) DOM again immediately, before the
      // re-verification below resolves — otherwise the previously visible
      // profile content flashes on screen for the round trip's duration.
      // currentUser itself is part of the frozen JS heap the browser just
      // restored, so it still holds whatever it held before navigating away
      // and must not be trusted until fetchCurrentUser() below overwrites it.
      document.documentElement.classList.add('auth-pending');
      fetchCurrentUser()
        .catch(() => {
          // Network/5xx: fail closed rather than trust the stale in-memory
          // user from before the bfcache restore.
          setUser(null);
        })
        .then(() => {
          if (!currentUser) {
            setNotice('Your session has expired. Please sign in again.', 'error');
            window.location.replace(urlFor(PATHS.login));
          } else {
            document.documentElement.classList.remove('auth-pending');
          }
        });
    });
  }

  // Cross-tab sign-out / sign-in propagation.
  window.addEventListener('storage', (e) => {
    if (e.key !== HINT_KEY) return;
    if (e.newValue === null) {
      currentUser = null;
      emit();
    }
  });

  return {
    PATHS,
    urlFor,
    init,
    fetchCurrentUser,
    getUser,
    isAuthenticated,
    register,
    login,
    logout,
    changePassword,
    requireAuth,
    redirectIfAuthenticated,
    handleSessionError,
    safeNext,
    onChange,
    setNotice,
    consumeNotice,
    guardBfcache,
  };
})();
