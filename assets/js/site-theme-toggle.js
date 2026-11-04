/**
 * SiteThemeToggle — the sun/moon button in the PUBLIC navbar.
 *
 * Injects ONE <button> into every `.pub-header` (the public site's pill
 * navbar). It is placed inside the header itself — not inside the collapsible
 * menu — so it stays visible on mobile next to the hamburger button.
 *
 * Depends on: site-theme-init.js (window.SiteTheme), loaded in <head>.
 * Never loaded on student pages.
 *
 * Icon rule (same as the student portal): Dark mode shows the SUN
 * ("switch to light"), Light mode shows the MOON ("switch to dark"). Both
 * icons live in the DOM and CSS picks one from [data-site-theme], so the
 * icon is right on first paint.
 *
 * A11y: real <button>; aria-label names the ACTION and flips with the theme.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SUN =
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
  var MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';

  function icon(cls, inner) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', 'site-theme-icon ' + cls);
    s.setAttribute('width', '18');
    s.setAttribute('height', '18');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.9');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.innerHTML = inner; // static, trusted markup defined above
    return s;
  }

  function current() {
    return window.SiteTheme ? window.SiteTheme.get() : 'dark';
  }

  function labelFor(theme) {
    return theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  }

  function create() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'site-theme-toggle';
    btn.setAttribute('data-site-theme-toggle', '');
    btn.append(icon('site-theme-icon-sun', SUN), icon('site-theme-icon-moon', MOON));

    function sync() {
      var label = labelFor(current());
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
    sync();

    btn.addEventListener('click', function () {
      if (window.SiteTheme) window.SiteTheme.toggle();
    });
    window.addEventListener('sitethemechange', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('pageshow', sync);
    return btn;
  }

  function mount() {
    document.querySelectorAll('.pub-header').forEach(function (header) {
      if (header.querySelector('[data-site-theme-toggle]')) return;
      var btn = create();
      var burger = header.querySelector('[data-nav-toggle]');
      // Before the hamburger so the two sit together on mobile.
      if (burger) header.insertBefore(btn, burger);
      else header.appendChild(btn);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
