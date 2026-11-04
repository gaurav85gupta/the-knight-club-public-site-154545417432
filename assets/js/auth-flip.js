/**
 * Auth flip — the controlled 3D transition between the Sign In and
 * Create Account faces of the login/signup pages.
 *
 * Both forms are always present in the DOM (see login.html / signup.html);
 * this script only toggles which one is interactive and visible, and plays
 * the flip. It never touches form state, validation or submission — those
 * stay owned by login.js / signup.js.
 *
 * STATE SAFETY
 * Switching faces never clears or copies form values, and the inactive
 * face is made unreachable (inert-like) so it cannot be tabbed into,
 * focused, or accidentally submitted via Enter while hidden.
 */
(function initAuthFlip() {
  const scene = document.getElementById('auth-scene');
  if (!scene) return;

  const switchLogin = document.getElementById('switch-login');
  const switchSignup = document.getElementById('switch-signup');
  const faceLogin = document.getElementById('auth-face-login');
  const faceSignup = document.getElementById('auth-face-signup');
  const flipCard = document.getElementById('auth-flip-card');

  /**
   * Sizes the card to the ACTIVE face's natural content height, not the
   * taller of the two. Each face is `height: fit-content` and absolutely
   * positioned (see auth.css), so its scrollHeight reflects its own
   * content regardless of which face is currently visible/rotated.
   */
  function syncHeight(which) {
    const face = which === 'signup' ? faceSignup : faceLogin;
    scene.style.setProperty('--auth-card-h', face.scrollHeight + 'px');
  }

  /** Disables focus/interaction on a hidden face without touching its values. */
  function setFaceInert(face, inert) {
    face.setAttribute('aria-hidden', inert ? 'true' : 'false');
    face.querySelectorAll('input, select, textarea, button, a').forEach((el) => {
      if (inert) {
        if (el.hasAttribute('tabindex')) el.dataset.prevTabindex = el.getAttribute('tabindex');
        el.setAttribute('tabindex', '-1');
      } else if (el.dataset.prevTabindex !== undefined) {
        el.setAttribute('tabindex', el.dataset.prevTabindex);
        delete el.dataset.prevTabindex;
      } else {
        el.removeAttribute('tabindex');
      }
    });
  }

  function setActive(which, { focus = true } = {}) {
    const toSignup = which === 'signup';
    scene.dataset.active = which;
    switchLogin.setAttribute('aria-selected', String(!toSignup));
    switchSignup.setAttribute('aria-selected', String(toSignup));
    setFaceInert(faceLogin, toSignup);
    setFaceInert(faceSignup, !toSignup);
    syncHeight(which);

    if (focus) {
      const activeFace = toSignup ? faceSignup : faceLogin;
      const heading = activeFace.querySelector('h1');
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
  }

  switchLogin.addEventListener('click', () => setActive('login'));
  switchSignup.addEventListener('click', () => setActive('signup'));

  // Arrow-key navigation between the two tab-style switch buttons.
  function onSwitchKeydown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    (event.target === switchLogin ? switchSignup : switchLogin).focus();
  }
  switchLogin.addEventListener('keydown', onSwitchKeydown);
  switchSignup.addEventListener('keydown', onSwitchKeydown);

  // "New here? Create an account" / "Already have an account? Sign in"
  // links flip in place instead of navigating, matching the controlled
  // flip interaction. They still carry a real href to the other page, so
  // they keep working with JS disabled, opening in a new tab, etc.
  document.querySelectorAll('[data-auth-switch]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setActive(link.dataset.authSwitch);
    });
  });

  // Initialize inert state and height to match whichever face the page
  // loaded with. Fonts/webfont swap can change wrapped-text height after
  // first paint, so re-measure once more after load.
  const initialActive = scene.dataset.active === 'signup' ? 'signup' : 'login';
  setActive(initialActive, { focus: false });
  window.addEventListener('load', () => syncHeight(scene.dataset.active));

  // Validation errors, server messages, or a textarea growing can change
  // the ACTIVE face's content height after the fact (e.g. a field-error
  // line wrapping to two lines). Re-measure whenever the active face's
  // content changes, so the card keeps fitting it without clipping.
  const resizeObserver = new ResizeObserver(() => syncHeight(scene.dataset.active));
  resizeObserver.observe(faceLogin);
  resizeObserver.observe(faceSignup);

  // Viewport width changes (orientation change, resizing a desktop window)
  // can reflow a face's content, which the ResizeObserver above already
  // catches via the face's own box, but window resize is listened for too
  // as a fallback for browsers where that reflow doesn't register as the
  // observed box changing immediately.
  window.addEventListener('resize', () => syncHeight(scene.dataset.active));

  // Exposed so signup.js can flip to the Sign In face in place after a
  // successful registration, instead of a full page navigation.
  window.AuthFlip = { setActive };
})();
