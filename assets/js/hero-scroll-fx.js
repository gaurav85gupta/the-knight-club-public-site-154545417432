/**
 * HeroScrollFX — cinematic blur/scale/dim on the pinned hero as the next
 * section slides up over it (home page only).
 *
 * The hero is `position: sticky; top: 0` (see home.css "CINEMATIC HERO
 * OVERLAP"), so while the viewport scrolls through the hero's own height
 * the hero itself never moves — only the sections after it slide up over
 * it. We measure that same progress (0 → 1 across one hero-height of
 * scroll) and write it to a CSS custom property on the hero element; the
 * actual blur/scale/dim/parallax visuals live in CSS (home.css) so this
 * file stays a tiny, dependency-free progress driver.
 *
 * Runs on rAF, reads scroll position only (no layout thrash in the loop),
 * and does nothing if the hero isn't on the page or the visitor prefers
 * reduced motion (CSS also has a reduced-motion fallback as a second
 * safety net).
 */
(function () {
  'use strict';

  var hero = document.querySelector('.home-page .hero.hero-v2');
  if (!hero) return;

  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) return;

  var ticking = false;
  var heroHeight = hero.offsetHeight || window.innerHeight;

  function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }

  function update() {
    ticking = false;
    var y = window.scrollY || window.pageYOffset || 0;
    // Progress through the hero's own height — matches exactly how far
    // the next section has slid up over the pinned hero.
    var progress = clamp01(y / heroHeight);
    hero.style.setProperty('--hero-scroll', progress.toFixed(4));
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  }

  function onResize() {
    heroHeight = hero.offsetHeight || window.innerHeight;
    onScroll();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  update();
})();
