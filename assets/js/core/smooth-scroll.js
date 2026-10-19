/**
 * SmoothScroll — the ONLY place smooth scrolling is configured.
 *
 * How it is wired:
 *   - assets/vendor/lenis/lenis.min.js  (self-hosted library, pinned version)
 *   - this file                          (config + public API)
 *   - PublicShell.mount()                (calls SmoothScroll.init() once per page)
 *
 * Page scripts must never call window.scrollTo / scrollIntoView directly.
 * Use the API below; it falls back to native smooth scrolling if Lenis is
 * unavailable or the visitor prefers reduced motion.
 *
 *   SmoothScroll.scrollTo('#choose')            // element or selector
 *   SmoothScroll.scrollTo(0)                    // pixel position (top)
 *   SmoothScroll.scrollTo(el, { offset: -20 })  // extra offset in px
 *   SmoothScroll.stop() / SmoothScroll.start()  // lock / unlock (modals, menus)
 *
 * Scrollable areas inside the page (modals, drawers, dropdowns, code boxes)
 * need the attribute  data-lenis-prevent  so they keep their own scrolling.
 */
(function (global) {
  'use strict';

  var CONFIG = {
    duration: 1.1,        // higher = floatier, lower = tighter
    smoothWheel: true,    // wheel / trackpad only; touch keeps native momentum
    easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); }
  };

  var lenis = null;
  var reducedMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  function resolve(target) {
    return typeof target === 'string' ? document.querySelector(target) : target;
  }

  // Same offset the browser applies natively: html scroll-padding-top
  // (set in css/1-base/scroll.css) + the element's own scroll-margin-top.
  function offsetFor(el) {
    var pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    var margin = el ? (parseFloat(getComputedStyle(el).scrollMarginTop) || 0) : 0;
    return -(pad + margin);
  }

  function init(options) {
    if (lenis) return lenis;
    if (typeof global.Lenis === 'undefined') return null;   // library not present -> native
    if (reducedMotion.matches) return null;                  // respect user setting

    lenis = new global.Lenis(Object.assign({}, CONFIG, options));

    function raf(time) {
      lenis.raf(time);
      global.requestAnimationFrame(raf);
    }
    global.requestAnimationFrame(raf);

    // In-page anchor links (<a href="#section">) go through the same engine.
    document.addEventListener('click', function (e) {
      var link = e.target.closest && e.target.closest('a[href^="#"]');
      if (!link || link.hasAttribute('data-no-smooth') || e.defaultPrevented) return;
      var hash = link.getAttribute('href');
      if (hash.length < 2) return;
      var el = null;
      try { el = document.querySelector(hash); } catch (err) { return; }
      if (!el) return;
      e.preventDefault();
      scrollTo(el);
      if (global.history && history.pushState) history.pushState(null, '', hash);
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    });

    return lenis;
  }

  function scrollTo(target, opts) {
    opts = opts || {};
    var el = typeof target === 'number' ? null : resolve(target);
    if (typeof target !== 'number' && !el) return;

    if (lenis) {
      var extra = typeof opts.offset === 'number' ? opts.offset : 0;
      lenis.scrollTo(el || target, {
        offset: (el ? offsetFor(el) : 0) + extra,
        immediate: Boolean(opts.immediate)
      });
      return;
    }

    // Native fallback (honours scroll-padding / scroll-margin automatically).
    var behavior = (reducedMotion.matches || opts.immediate) ? 'auto' : 'smooth';
    if (el) {
      el.scrollIntoView({ behavior: behavior, block: 'start' });
    } else {
      global.scrollTo({ top: target, behavior: behavior });
    }
  }

  function stop()  { if (lenis) lenis.stop(); }
  function start() { if (lenis) lenis.start(); }

  global.SmoothScroll = {
    init: init,
    scrollTo: scrollTo,
    stop: stop,
    start: start,
    get instance() { return lenis; }
  };
})(window);
