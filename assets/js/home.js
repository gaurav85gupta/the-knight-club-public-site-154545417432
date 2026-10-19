/**
 * Home page controller.
 *
 * ONE request loads the newest published courses (Catalog.listCourses).
 * No polling, no extra calls (spec 33, 68).
 *
 * That single response feeds the Featured Courses grid and the hero
 * product-showcase visual (which uses the first real course), so the
 * redesign does not add network traffic.
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
      return `<img src="${esc(course.thumbnail)}" alt="" loading="lazy" decoding="async" />`;
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
   * There is no cart in this codebase, so no Add to Cart / View Cart state exists.
   */
  function ctaHtml(course, owned) {
    return owned
      ? '<a class="hc-cta hc-cta-owned" href="pages/learning.html">Go to Learning</a>'
      : `<a class="hc-cta" href="pages/course.html?slug=${encodeURIComponent(course.slug)}">View Course</a>`;
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
            <span class="hc-cta-slot">${ctaHtml(course, false)}</span>
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
      });
    } catch { /* keep "View Course" — never block the catalog on this */ }
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

  // ---- loaders ----------------------------------------------------------------

  async function loadFeaturedCourses() {
    const el = document.getElementById('featured-courses');
    if (!el) return;
    el.innerHTML = skeletonCards(3);
    try {
      const data = await Catalog.listCourses({ sort: 'newest', limit: FEATURED_LIMIT, page: 1 });
      const items = (data && data.items) || [];
      if (!items.length) {
        el.innerHTML = `
          <div class="hc-state">
            <h3>No courses yet</h3>
            <p>New courses will appear here as soon as they are published.</p>
          </div>`;
        return;
      }
      el.innerHTML = items.map(courseCardHtml).join('');
      markOwnedCourses(el);
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
