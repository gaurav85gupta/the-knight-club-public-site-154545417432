/**
 * SiteTheme — Dark / Light mode for the PUBLIC marketing site only.
 *
 * Load as a plain, blocking <script> in <head> BEFORE the stylesheets, on
 * public pages only. It runs synchronously and sets `data-site-theme` on
 * <html>, so the first paint already uses the right palette (no flash).
 *
 * SCOPE — this file is deliberately separate from the student portal's
 * theme (theme-init.js):
 *   - attribute : `data-site-theme`   (student portal uses `data-theme`)
 *   - storage   : `tnc_site_theme`    (student portal uses `tnc_theme`)
 * The two never read or write each other's values, so toggling here cannot
 * change the student portal, and the student portal's toggle cannot change
 * this site. Student pages never load this file.
 *
 * DEFAULT — no saved preference -> 'dark' (the existing look).
 */
(function () {
  'use strict';

  var KEY = 'tnc_site_theme';
  var DARK = 'dark';
  var LIGHT = 'light';
  var root = document.documentElement;

  // Colours that show behind browser chrome / overscroll.
  var CHROME = { dark: '#0a0714', light: '#f3f0ff' };

  function read() {
    try {
      var v = window.localStorage.getItem(KEY);
      return v === LIGHT || v === DARK ? v : DARK;
    } catch (e) {
      return DARK;
    }
  }

  // <meta name="theme-color"> lives later in <head>, so it may not be parsed yet
  // when this script first runs. Update every existing one now, and again once
  // the DOM is ready (creating one only if the page has none at all).
  function syncChrome(theme, final) {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (!metas.length && final) {
      var m = document.createElement('meta');
      m.name = 'theme-color';
      (document.head || root).appendChild(m);
      metas = [m];
    }
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', CHROME[theme]);
  }

  function apply(theme) {
    root.setAttribute('data-site-theme', theme);
    root.style.colorScheme = theme; // native scrollbars / form controls follow
    syncChrome(theme, document.readyState !== 'loading');
  }

  // Colour fade only around a user-initiated switch (never on first paint).
  var timer = null;
  function withTransition() {
    root.classList.add('site-theme-transition');
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      root.classList.remove('site-theme-transition');
    }, 380);
  }

  function get() {
    return root.getAttribute('data-site-theme') === LIGHT ? LIGHT : DARK;
  }

  function set(theme) {
    var next = theme === LIGHT ? LIGHT : DARK;
    withTransition();
    apply(next);
    try { window.localStorage.setItem(KEY, next); } catch (e) { /* not persisted */ }
    try {
      window.dispatchEvent(new CustomEvent('sitethemechange', { detail: { theme: next } }));
    } catch (e) { /* very old browsers */ }
    return next;
  }

  function toggle() {
    return set(get() === LIGHT ? DARK : LIGHT);
  }

  apply(read());
  document.addEventListener('DOMContentLoaded', function () { syncChrome(get(), true); });

  // Another tab changed the preference -> follow it.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) {
      apply(read());
      try { window.dispatchEvent(new CustomEvent('sitethemechange', { detail: { theme: get() } })); } catch (err) {}
    }
  });

  // bfcache restore (Back button) must never show a stale theme.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) apply(read());
  });

  window.SiteTheme = { get: get, set: set, toggle: toggle, LIGHT: LIGHT, DARK: DARK };
})();
