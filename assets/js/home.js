/**
 * Home page controller.
 *
 * ONE request loads the newest published courses (Catalog.listCourses).
 * No polling, no extra calls (spec 33, 68).
 *
 * That single response feeds both the Featured Courses grid (first
 * FEATURED_LIMIT items — same slice, same order a dedicated 3-item request
 * would have returned) and the hero course orbit (up to ORBIT_LIMIT items),
 * so the redesign does not add network traffic.
 *
 * DATA INTEGRITY: nothing here is hardcoded. Titles, prices, instructors and
 * categories all come from the API. Any optional field that is missing is
 * simply omitted.
 *
 * R1 cleanup: this file previously also called loadCategories() and
 * addTrustCount(), which populated #home-categories / #categories-section
 * and #trust-strip. None of those three elements exist in index.html any
 * more (verified against the current markup), so those were dead code —
 * loadCategories() fired a full Catalog.listCategories() request on every
 * homepage load for zero visual effect, every time, for every visitor.
 * Removed both functions and their call sites; Catalog.listCategories()
 * itself is untouched and still used by courses.js on the courses page.
 */

(function initHomePage() {
  const FEATURED_LIMIT = 3;
  // Orbit needs more cards than the 3-up Featured grid to read as a ring;
  // same single request still covers both (see loadFeaturedCourses below).
  const ORBIT_LIMIT = 10; // ring shows newest 10; spacing auto-adjusts for any count up to this

  // ---- tiny helpers -------------------------------------------------------

  const esc = (v) => Format.escapeHtml(v);

  /** Deterministic 32-bit hash so the same course always gets the same fallback art. */
  function hash(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /**
   * Up to two initials from the title (e.g. "Digital Marketing" -> "DM").
   * Falls back to the category, then to the brand mark — never a bare "?".
   */
  function initialsFor(course) {
    const words = String(course.title || '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    const cat = course.category && course.category.name;
    if (cat) return String(cat).slice(0, 2).toUpperCase();
    return 'NC';
  }

  /**
   * Generated thumbnail used when a course has no image. Built from the
   * course's own data (title initials + category) and a deterministic seed
   * that varies the light position / shape layout, so the grid feels varied
   * yet intentional. Pure CSS/HTML — no external assets.
   */
  function fallbackThumb(course, variantClass, withLabel) {
    const seed = hash(course.slug || course.id || course.title);
    const v = seed % 4; // 4 geometric layouts
    const hue = 258 + ((seed >>> 3) % 5) * 6; // stay inside the purple family (258–282)
    const lx = 18 + ((seed >>> 5) % 64); // glow position, %
    const ly = 14 + ((seed >>> 9) % 56);
    const cat = course.category && course.category.name;
    return `
      <div class="thumb-art ${variantClass || ''} art-v${v}" aria-hidden="true"
           style="--art-hue:${hue};--art-x:${lx}%;--art-y:${ly}%;">
        <span class="art-shape art-shape-a"></span>
        <span class="art-shape art-shape-b"></span>
        <span class="art-initials">${esc(initialsFor(course))}</span>
        ${cat && withLabel ? `<span class="art-label">${esc(cat)}</span>` : ''}
      </div>`;
  }

  function thumbHtml(course) {
    if (course.thumbnail) {
      return `<img src="${esc(course.thumbnail)}" alt="${esc(course.title)}" loading="lazy" decoding="async" />`;
    }
    return fallbackThumb(course);
  }

  // ---- featured course card ------------------------------------------------

  function discountPct(pricing) {
    if (!pricing || pricing.isFree || !(pricing.basePrice > pricing.salePrice) || !(pricing.basePrice > 0)) return 0;
    return Math.round((1 - pricing.salePrice / pricing.basePrice) * 100);
  }

  /**
   * One primary action per card, never two conflicting states:
   *   owned      -> "Go to Learning"  (pages/learning.html)
   *   otherwise  -> "View Course"     (pages/course.html; purchase happens there)
   * Paid, not-yet-owned courses additionally get a small secondary Add to
   * Cart icon-button (see cartBtnHtml) — same Cart.js used on course.html.
   */
  function ctaHtml(course, owned) {
    return owned
      ? '<a class="hc-cta hc-cta-owned" href="pages/learning.html">Go to Learning</a>'
      : `<a class="hc-cta" href="pages/course.html?slug=${encodeURIComponent(course.slug)}">View Course</a>`;
  }

  // Same glyph as the navbar's cart icon (public-shell.js) and the course
  // detail page's Add to Cart button.
  const CART_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';
  const CHECK_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  function cartBtnHtml(course) {
    const canAddToCart = Boolean(course.id) && course.pricing && !course.pricing.isFree;
    return canAddToCart
      ? `<button type="button" class="hc-cart-btn" data-course-id="${esc(course.id)}" aria-label="Add ${esc(course.title)} to cart" title="Add to cart">${CART_SVG}</button>`
      : '';
  }

  function courseCardHtml(course) {
    const href = `pages/course.html?slug=${encodeURIComponent(course.slug)}`;
    const original = Format.originalPrice(course.pricing);
    const level = Format.level(course.metadata && course.metadata.level);
    const price = Format.price(course.pricing);
    const pct = discountPct(course.pricing);
    return `
      <article class="hc-card" data-slug="${esc(course.slug)}">
        <div class="hc-thumb">
          ${thumbHtml(course)}
          <div class="hc-badges">
            ${course.category ? `<span class="hc-badge hc-badge-cat">${esc(course.category.name)}</span>` : ''}
            ${level ? `<span class="hc-badge">${esc(level)}</span>` : ''}
          </div>
        </div>
        <div class="hc-body">
          <h3 class="hc-title"><a href="${href}">${esc(course.title)}</a></h3>
          ${course.shortDescription ? `<p class="hc-desc">${esc(Format.truncate(course.shortDescription, 110))}</p>` : ''}
          ${course.instructor ? `<p class="hc-instructor">${esc(course.instructor.name)}</p>` : ''}
          <div class="hc-foot">
            <span class="hc-price">
              ${price ? `<span class="hc-price-now">${esc(price)}</span>` : ''}
              ${original ? `<span class="hc-price-was">${esc(original)}</span>` : ''}
              ${pct ? `<span class="hc-off">${pct}% off</span>` : ''}
            </span>
            <span class="hc-cta-group">
              ${cartBtnHtml(course)}
              <span class="hc-cta-slot">${ctaHtml(course, false)}</span>
            </span>
          </div>
        </div>
      </article>`;
  }

  /** Best-effort: signed-in students get "Go to Learning" on courses they already own. */
  async function markOwnedCourses(root) {
    try {
      if (typeof Auth === 'undefined' || !(await Auth.init())) return;
      const dash = await Api.get('/students/me/dashboard');
      const owned = new Set((dash.myLearnings || []).map((l) => l.slug).filter(Boolean));
      root.querySelectorAll('.hc-card[data-slug]').forEach((card) => {
        if (!owned.has(card.dataset.slug)) return;
        const slot = card.querySelector('.hc-cta-slot');
        if (slot) slot.innerHTML = ctaHtml({ slug: card.dataset.slug }, true);
        // Already owned: no point offering Add to Cart on this card.
        const cartBtn = card.querySelector('.hc-cart-btn');
        if (cartBtn) cartBtn.remove();
      });
    } catch { /* keep "View Course" — never block the catalog on this */ }
  }

  // ---- Add to Cart (featured course cards) ---------------------------------
  //
  // One delegated listener on #featured-courses — mirrors the course detail
  // page's Add to Cart button (course-detail.js): same Cart.addToCart call,
  // same 401/409 handling, same Auth.requireAuth() gate on click.
  function wireCartButtons() {
    const el = document.getElementById('featured-courses');
    if (!el || typeof Cart === 'undefined') return;
    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('.hc-cart-btn');
      if (!btn || btn.disabled) return;
      const courseId = btn.dataset.courseId;
      if (!courseId) return;

      try {
        await Auth.requireAuth();
      } catch {
        return; // requireAuth handles the redirect
      }

      btn.disabled = true;
      btn.classList.add('is-loading');

      try {
        await Cart.addToCart(courseId);
        btn.classList.remove('is-loading');
        btn.classList.add('is-added');
        btn.innerHTML = CHECK_SVG;
        btn.setAttribute('aria-label', 'Already in cart');
        btn.title = 'In cart';
        if (typeof StudentUI !== 'undefined' && StudentUI.toast) {
          StudentUI.toast('Added to cart!', 'success');
        }
      } catch (err) {
        btn.classList.remove('is-loading');
        if (err && err.status === 409) {
          // Already purchased — nothing useful left for this button to do.
          btn.remove();
        } else if (err && err.status === 401) {
          Auth.handleSessionError(err);
        } else {
          // Recoverable: let the student try again.
          btn.disabled = false;
        }
      }
    });
  }
  wireCartButtons();

  // ---- hero course orbit (desktop ring + mobile scroll strip) -------------
  //
  // Both share one card markup and the same courses array passed in from
  // loadFeaturedCourses — no separate request. The desktop ring additionally
  // needs --i/--n (this card's index / total count) for its CSS placement
  // transform (home.css §COURSE ORBIT), and a `data-front` flag that lets
  // CSS keep the card(s) nearest the viewer at full opacity. Because the
  // ring spins continuously, "front" is reassessed on an interval rather
  // than once, so the depth cue stays correct as the rotation progresses.

  function orbitCardHtml(course) {
    const href = `pages/course.html?slug=${encodeURIComponent(course.slug)}`;
    const price = Format.price(course.pricing);
    return `
      <a class="hero-orbit-card-face" href="${href}" aria-label="${esc(course.title)}">
        <div class="hero-orbit-thumb">
          ${thumbHtml(course)}
          ${course.category ? `<span class="hero-orbit-badge">${esc(course.category.name)}</span>` : ''}
        </div>
        <div class="hero-orbit-body">
          <h3 class="hero-orbit-title">${esc(course.title)}</h3>
          ${price ? `<span class="hero-orbit-price">${esc(price)}</span>` : ''}
        </div>
      </a>`;
  }

  /** Marks the card(s) closest to rotation angle 0 (facing the viewer) as front. */
  function updateOrbitFront(track, n) {
    if (!n) return;
    const styles = getComputedStyle(track);
    const m = /matrix3d\(([^)]+)\)/.exec(styles.transform);
    let angle = 0;
    if (m) {
      const v = m[1].split(',').map(Number);
      // matrix3d[0] and [8] give enough to recover the Y rotation.
      angle = Math.atan2(v[8], v[0]);
    }
    const step = (Math.PI * 2) / n;
    const frontIndex = ((Math.round(-angle / step) % n) + n) % n;
    track.querySelectorAll('.hero-orbit-card').forEach((card, i) => {
      card.dataset.front = String(i === frontIndex);
    });
  }

  function populateOrbit(items) {
    // Desktop/tablet 3D ring only — mobile shows the Featured Courses grid
    // below the hero instead (#featured-courses), so there is no separate
    // mobile track to populate here (see the 640px breakpoint in home.css).
    const region = document.getElementById('hero-orbit');
    const track = document.getElementById('hero-orbit-track');
    if (!region || !track) return;
    if (!items.length) return; // intentional empty state: stay hidden, no fabricated cards

    const n = items.length;
    track.innerHTML = items
      .map((course, i) => `<div class="hero-orbit-card" style="--i:${i};--n:${n}">${orbitCardHtml(course)}</div>`)
      .join('');

    region.hidden = false;
    region.removeAttribute('aria-hidden');

    // Space the cards so they never touch, whatever the course count.
    // Adjacent cards on a ring of radius R have centres 2R·tan(π/n) apart
    // (flat-face spacing), so R must grow with n. R is capped so the ring
    // stays inside the hero column; beyond the cap the cards shrink a bit
    // instead (--hero-orbit-scale) so the gap is always preserved.
    function layoutOrbit() {
      const BASE_SCALE = 0.95; // overall card size (1 = original)
      track.style.removeProperty('--hero-orbit-radius');
      track.style.setProperty('--hero-orbit-scale', String(BASE_SCALE));
      if (n < 3) return;
      const first = track.querySelector('.hero-orbit-card');
      const cardW = first.offsetWidth;
      const baseR = parseFloat(getComputedStyle(track).getPropertyValue('--hero-orbit-radius')) || 170;
      const shownW = cardW * BASE_SCALE;
      const GAP = Math.max(24, shownW * 0.12);
      const t = Math.tan(Math.PI / n);
      const wantR = (shownW + GAP) / (2 * t);
      const maxR = baseR * 1.45;
      const R = Math.max(baseR * 0.85, Math.min(wantR, maxR));
      const fitW = 2 * R * t - GAP;
      const scale = Math.min(BASE_SCALE, fitW / cardW);
      track.style.setProperty('--hero-orbit-radius', R.toFixed(1) + 'px');
      track.style.setProperty('--hero-orbit-scale', scale.toFixed(3));
    }
    layoutOrbit();
    let orbitResizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(orbitResizeTimer);
      orbitResizeTimer = setTimeout(layoutOrbit, 150);
    });

    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      updateOrbitFront(track, n);
      window.setInterval(() => updateOrbitFront(track, n), 600);
    } else {
      track.querySelectorAll('.hero-orbit-card').forEach((card) => { card.dataset.front = 'true'; });
    }
  }

  function skeletonCards(n) {
    return Array.from({ length: n })
      .map(
        () => `
        <div class="hc-card hc-skeleton" aria-hidden="true">
          <div class="hc-thumb skeleton"></div>
          <div class="hc-body">
            <span class="skeleton sk-line"></span>
            <span class="skeleton sk-line sk-short"></span>
            <span class="skeleton sk-line sk-price"></span>
          </div>
        </div>`
      )
      .join('');
  }

  // ---- hero stats count-up ------------------------------------------------

  /**
   * Animates each [data-count-to] number from 0 up to its target once it
   * scrolls into view. Runs once per element (IntersectionObserver unobserves
   * after triggering). Respects prefers-reduced-motion by snapping straight
   * to the final value with no animation.
   */
  function animateHeroStats() {
    const els = document.querySelectorAll('[data-count-to]');
    if (!els.length) return;

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const DURATION = 1400; // ms

    function run(el) {
      const target = parseInt(el.getAttribute('data-count-to'), 10) || 0;
      const suffix = el.getAttribute('data-count-suffix') || '';

      if (reduceMotion) {
        el.textContent = target + suffix;
        return;
      }

      const start = performance.now();
      function tick(now) {
        const progress = Math.min((now - start) / DURATION, 1);
        // ease-out cubic — fast start, settles gently on the target
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = Math.round(target * eased);
        el.textContent = value + suffix;
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          el.textContent = target + suffix; // guarantee exact final value
        }
      }
      requestAnimationFrame(tick);
    }

    if (!('IntersectionObserver' in window)) {
      els.forEach(run);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          run(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    els.forEach((el) => observer.observe(el));
  }

  animateHeroStats();

  // ---- loaders ----------------------------------------------------------------

  async function loadFeaturedCourses() {
    const el = document.getElementById('featured-courses');
    if (!el) return;
    el.innerHTML = skeletonCards(3);
    try {
      // One request serves both: Featured Courses (first FEATURED_LIMIT) and
      // the hero orbit (up to ORBIT_LIMIT, the same published-newest list —
      // see populateOrbit). No second network call added for the orbit.
      const data = await Catalog.listCourses({ sort: 'newest', limit: ORBIT_LIMIT, page: 1 });
      const items = (data && data.items) || [];
      if (!items.length) {
        el.innerHTML = `
          <div class="hc-state">
            <h3>No courses yet</h3>
            <p>New courses will appear here as soon as they are published.</p>
          </div>`;
        return; // populateOrbit is never called: no courses to show, no fallback content invented
      }
      el.innerHTML = items.slice(0, FEATURED_LIMIT).map(courseCardHtml).join('');
      markOwnedCourses(el);
      populateOrbit(items);
    } catch (err) {
      el.innerHTML = `
        <div class="hc-state">
          <h3>Couldn't load courses</h3>
          <p>${err instanceof ApiError ? esc(err.message) : 'Something went wrong. Please try again.'}</p>
          <button class="btn btn-outline" id="retry-featured" type="button">Try again</button>
        </div>`;
      const retry = document.getElementById('retry-featured');
      if (retry) retry.addEventListener('click', loadFeaturedCourses);
    }
  }

  loadFeaturedCourses();
})();