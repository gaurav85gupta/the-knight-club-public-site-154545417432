/**
 * ThemeToggle — the one sun/moon button, used by both the student shell
 * (student-shell.js) and the course-learning header (learn.html), so there is
 * a single implementation of the control.
 *
 * Depends on: theme-init.js (window.Theme), which is loaded in <head>.
 *
 * ACCESSIBILITY
 * - A real <button> (keyboard + screen-reader operable, focus ring from the
 *   shared :focus-visible rules).
 * - aria-label names the ACTION ("Switch to light mode"), which is the most
 *   reliable pattern for a two-state control. We do NOT also set aria-pressed
 *   — combining a changing label with a pressed state announces the state
 *   twice and contradicts itself.
 * - The icon is decorative (aria-hidden); the label carries the meaning.
 *
 * ICON RULE (from the brief)
 *   In Night mode the button shows the SUN  -> "switch to Day".
 *   In Day mode   the button shows the MOON -> "switch to Night".
 * Both SVGs live in the DOM and CSS shows the right one from [data-theme],
 * so the icon is correct on first paint with no JS timing dependency.
 */
const ThemeToggle = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Static, trusted path data only — never built from user/API input.
  const SUN =
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
  const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';

  function icon(cls, inner) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', `theme-icon ${cls}`);
    s.setAttribute('width', '18');
    s.setAttribute('height', '18');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.innerHTML = inner; // static markup above
    return s;
  }

  function labelFor(theme) {
    return theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  }

  /** @returns {HTMLButtonElement} a wired-up toggle. */
  function create(extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theme-toggle${extraClass ? ` ${extraClass}` : ''}`;
    btn.dataset.themeToggle = '';
    btn.append(icon('theme-icon-sun', SUN), icon('theme-icon-moon', MOON));

    const sync = () => {
      const label = labelFor(window.Theme ? window.Theme.get() : 'dark');
      btn.setAttribute('aria-label', label);
      btn.title = label;
    };
    sync();

    btn.addEventListener('click', () => {
      if (window.Theme) window.Theme.toggle();
    });
    // Keeps the label right when the theme changes from anywhere (another
    // toggle instance, another tab, bfcache restore).
    window.addEventListener('themechange', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('pageshow', sync);
    return btn;
  }

  return { create };
})();
