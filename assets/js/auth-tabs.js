/**
 * Auth tabs — switches between the Sign In and Create Account forms on
 * the centered auth card. Both forms are always present in the DOM (see
 * login.html / signup.html); this script only toggles which one is
 * visible/interactive. It never touches form state, validation or
 * submission — those stay owned by login.js / signup.js.
 *
 * STATE SAFETY
 * Switching tabs never clears or copies form values, and the inactive
 * form is hidden with the `hidden` attribute (plus aria-hidden) so it
 * cannot be tabbed into, focused, or accidentally submitted via Enter
 * while hidden.
 */
(function initAuthTabs() {
  const scene = document.getElementById('auth-scene');
  if (!scene) return;

  const switchLogin = document.getElementById('switch-login');
  const switchSignup = document.getElementById('switch-signup');
  const faceLogin = document.getElementById('auth-face-login');
  const faceSignup = document.getElementById('auth-face-signup');

  function setActive(which, { focus = true } = {}) {
    const toSignup = which === 'signup';
    scene.dataset.active = which;
    switchLogin.setAttribute('aria-selected', String(!toSignup));
    switchSignup.setAttribute('aria-selected', String(toSignup));

    faceLogin.hidden = toSignup;
    faceLogin.setAttribute('aria-hidden', String(toSignup));
    faceSignup.hidden = !toSignup;
    faceSignup.setAttribute('aria-hidden', String(!toSignup));

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
  // links switch tabs in place instead of navigating. They still carry a
  // real href to the other page, so they keep working with JS disabled,
  // opening in a new tab, etc.
  document.querySelectorAll('[data-auth-switch]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setActive(link.dataset.authSwitch);
    });
  });

  // Initialize to match whichever face the page loaded with.
  const initialActive = scene.dataset.active === 'signup' ? 'signup' : 'login';
  setActive(initialActive, { focus: false });

  // Exposed so signup.js can switch to the Sign In face in place after a
  // successful registration, instead of a full page navigation.
  window.AuthFlip = { setActive };
})();