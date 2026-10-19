/**
 * Theme — the single source of truth for the STUDENT area's Day / Night mode.
 *
 * MUST be loaded as a plain, blocking <script> in <head>, BEFORE the
 * stylesheets, on student pages only. It runs synchronously, sets
 * `data-theme` on <html>, and returns — so the very first paint already uses
 * the right palette (no dark -> light flash).
 *
 * SCOPE
 * The public marketing site never loads this file. Without `data-theme` on
 * <html>, every rule in student-theme.css is inert, so public pages render
 * exactly as they always have.
 *
 * STORAGE
 * One localStorage key, `tnc_theme` = 'light' | 'dark'. It is a pure
 * presentation preference: it grants nothing, and it is intentionally NOT
 * cleared on sign-out (a student who prefers Day mode should still get Day
 * mode on their next visit). It is separate from auth's `tnc_signed_in` hint.
 * If storage is unavailable (private mode, blocked cookies) the theme still
 * works for the current page view; it just won't persist.
 *
 * DEFAULT
 * No saved preference -> 'dark' (the existing Night Club identity). We
 * deliberately do NOT follow prefers-color-scheme: the brand default is Night.
 */
(function () {
  'use strict';

  var KEY = 'tnc_theme';
  var DARK = 'dark';
  var LIGHT = 'light';
  var root = document.documentElement;

  function read() {
    try {
      var v = window.localStorage.getItem(KEY);
      return v === LIGHT || v === DARK ? v : DARK;
    } catch (e) {
      return DARK;
    }
  }

  // Colours that show through browser chrome / overscroll. Kept here (not in
  // CSS) because <meta name="theme-color"> can only be set as an attribute.
  var CHROME = { dark: '#0a0714', light: '#f6f4fb' };

  function syncChrome(theme) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      (document.head || root).appendChild(meta);
    }
    meta.setAttribute('content', CHROME[theme]);
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    // Lets the browser pick matching native form controls, scrollbars and
    // autofill colours for the active theme.
    root.style.colorScheme = theme;
    syncChrome(theme);
  }

  // A short-lived class that switches on colour transitions (student-theme.css
  // section E). Added ONLY around a user-initiated switch — never on initial
  // load — so first paint never animates, and hover/entry animations are left
  // alone the rest of the time.
  var transitionTimer = null;
  function withTransition() {
    root.classList.add('theme-transition');
    window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(function () {
      root.classList.remove('theme-transition');
    }, 320);
  }

  function set(theme) {
    var next = theme === LIGHT ? LIGHT : DARK;
    withTransition();
    apply(next);
    try { window.localStorage.setItem(KEY, next); } catch (e) { /* non-persistent */ }
    try {
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
    } catch (e) { /* very old browsers */ }
    return next;
  }

  function get() {
    return root.getAttribute('data-theme') === LIGHT ? LIGHT : DARK;
  }

  function toggle() {
    return set(get() === LIGHT ? DARK : LIGHT);
  }

  // ---- Initialise immediately (this is the no-flash step) -------------------
  apply(read());

  // Another tab changed the preference -> follow it.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) apply(read());
  });

  // bfcache restore (Back button) should never show a stale theme.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) apply(read());
  });

  window.Theme = { get: get, set: set, toggle: toggle, LIGHT: LIGHT, DARK: DARK };
})();
