/**
 * Nav — shared header behavior for every public (non-auth-shell) page.
 *
 * Two responsibilities, both DISPLAY ONLY (see auth.js header comment: the
 * backend is the sole authority on access; this only decides what a link
 * says and points to):
 *
 *   1. Auth-state swap: an unauthenticated header shows "Get Started / Login";
 *      once the server confirms a session (Auth.init(), which is cheap for
 *      a logged-out visitor thanks to the localStorage hint) it swaps to a
 *      single "Dashboard" link. The public header is a marketing surface,
 *      not the student shell — it never grows account/logout controls;
 *      those live in the protected pages' own student-shell navigation.
 *   2. Mobile nav toggle: shows/hides the collapsed link list.
 *
 * Every page that includes this script must have:
 *   - a `.site-nav` element with `data-nav-toggle` (button) and `.nav-links`
 *   - inside `.nav-links`: the two auth-only links marked
 *     `data-auth="guest"` (shown when signed out) and `data-auth="user"`
 *     (shown when signed in, hidden by default via the `hidden` attribute)
 */

(function initNav() {
  const navs = document.querySelectorAll('[data-site-nav]');
  navs.forEach((nav) => {
    const toggle = nav.querySelector('[data-nav-toggle]');
    if (toggle) {
      toggle.addEventListener('click', () => {
        nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(nav.classList.contains('is-open')));
      });
    }
  });

  // Close mobile menu on link click / outside click.
  document.addEventListener('click', (e) => {
    navs.forEach((nav) => {
      if (!nav.classList.contains('is-open')) return;
      if (nav.contains(e.target)) {
        if (e.target.closest('a')) nav.classList.remove('is-open');
        return;
      }
      nav.classList.remove('is-open');
    });
  });

  if (typeof Auth === 'undefined') {
    // Auth.js failed to load: fall back to the guest CTA rather than
    // leaving the action area permanently blank.
    document.querySelectorAll('.nav-actions[data-auth-pending]').forEach((el) => {
      el.removeAttribute('data-auth-pending');
    });
    return;
  }

  /**
   * Applies a resolved auth state to the header AND clears the auth-pending
   * flag on each `.nav-actions` container. Until this runs once, CSS keeps
   * both the guest and signed-in CTA groups invisible (see site.css
   * `[data-auth-pending]`) so a signed-in visitor never sees a flash of
   * "Get Started / Login" before their real "Dashboard" state is known.
   * Only this action area waits — the rest of the page renders immediately.
   */
  function applyAuthState(user) {
    document.querySelectorAll('[data-auth="guest"]').forEach((el) => {
      el.hidden = Boolean(user);
    });
    document.querySelectorAll('[data-auth="user"]').forEach((el) => {
      el.hidden = !user;
    });
    document.querySelectorAll('.nav-actions[data-auth-pending]').forEach((el) => {
      el.removeAttribute('data-auth-pending');
    });
  }

  async function syncAuthState() {
    applyAuthState(await Auth.init());
  }

  syncAuthState();
  Auth.onChange(syncAuthState);

  // ---- Cart badge (public navbar) -----------------------------------------
  // Mirrors the student shell's cart badge wiring exactly (see
  // student-shell.js). Only pages that load cart.js show a live count;
  // pages that don't (the cart link itself still renders via public-shell.js,
  // but the badge simply stays at 0/hidden) degrade silently.
  if (typeof Cart !== 'undefined') {
    function applyCartCount(count) {
      const badge = document.getElementById('pub-cart-badge');
      if (!badge) return;
      if (!count || count <= 0) {
        badge.textContent = '';
        badge.classList.add('cart-badge--hidden');
      } else {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.remove('cart-badge--hidden');
      }
    }
    Cart.onCountChange(applyCartCount);
    Cart.fetchCount().then(applyCartCount).catch(() => { /* silent */ });
  }

  // Guard against the browser's back-forward cache (bfcache): navigating
  // back to a public page (e.g. after signing out on a student page) can
  // restore the previously-rendered DOM AND the frozen JS heap straight
  // from memory, with no script re-run — so a stale "Dashboard" link can
  // stay visible after sign-out, and `Auth.init()` would just return its
  // cached (`bootstrapped`) in-memory value instead of re-checking. `pageshow`'s
  // `persisted` flag is true only for that restore case; on it, ask the
  // server directly (`fetchCurrentUser()`, bypassing the `init()` cache) and
  // re-apply the header state. (See auth.js `guardBfcache()` for the
  // stricter version used on protected pages — this page is public, so it
  // never hides content or forces a redirect, only re-syncs the header.)
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    Auth.fetchCurrentUser()
      .catch(() => null) // network/5xx: don't trust the frozen pre-restore state — treat as guest, same as Auth.init()
      .then(applyAuthState);
  });
})();
