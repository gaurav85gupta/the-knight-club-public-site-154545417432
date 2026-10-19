/**
 * Courses (catalog listing) page controller — premium redesign.
 *
 * Drives the #courses-list grid on pages/courses.html: search, sort,
 * category filter (via ?category=<id> set from the homepage's category
 * chips) and pagination — all backed by GET /courses through
 * Catalog.listCourses(), which only ever returns PUBLISHED+PUBLIC courses
 * (see backend/src/services/publicCourse.service.js).
 *
 * State (search/sort/category/page) is mirrored into the URL query string
 * so a filtered/paginated view is a shareable, reload-safe link. NONE of
 * that state/URL/API logic changed in this redesign — only the rendered
 * markup (cc-* premium card/hero/toolbar) and two presentational additions
 * that reuse existing state: a "clear search" button, and real (never
 * fabricated) course/category counts in the hero, sourced the same way
 * home.js's trust-strip counts are (pagination.total / categories length).
 *
 * Phase C1 (information architecture): the page was re-ordered into
 * hero -> skill areas -> catalogue -> guidance. The "Skill areas" cards are
 * rendered from the SAME real categories as the filter chips (one
 * Catalog.listCategories() call) and drive the SAME state.category through
 * selectCategory() — there is no second filter state or second fetch.
 */

(function initCoursesListPage() {
  const listEl = document.getElementById('courses-list');
  const summaryEl = document.getElementById('results-summary');
  const filtersForm = document.getElementById('filters-form');
  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear');
  const sortSelect = document.getElementById('sort-select');
  const categoryFilterEl = document.getElementById('category-filter');
  const categoryBlockEl = document.getElementById('category-block');
  const skillGridEl = document.getElementById('skill-areas-grid');
  const catalogEl = document.getElementById('catalog');
  const heroStatsEl = document.getElementById('hero-stats');
  const heroStatsSkeletonEl = document.getElementById('hero-stats-skeleton');
  const paginationEl = document.getElementById('pagination');
  const paginationStatusEl = document.getElementById('pagination-status');
  const prevPageBtn = document.getElementById('prev-page');
  const nextPageBtn = document.getElementById('next-page');

  const PAGE_LIMIT = 12;

  const state = {
    search: '',
    sort: 'newest',
    category: '',
    categoryName: '', // display-only, filled in once category chips load
    page: 1,
  };

  const esc = (v) => Format.escapeHtml(v);

  function readStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    state.search = params.get('search') || '';
    state.sort = params.get('sort') || 'newest';
    state.category = params.get('category') || '';
    const page = parseInt(params.get('page'), 10);
    state.page = Number.isFinite(page) && page > 0 ? page : 1;
  }

  function writeStateToUrl() {
    const params = new URLSearchParams();
    if (state.search) params.set('search', state.search);
    if (state.sort && state.sort !== 'newest') params.set('sort', state.sort);
    if (state.category) params.set('category', state.category);
    if (state.page > 1) params.set('page', String(state.page));
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    window.history.replaceState({}, '', newUrl);
  }

  function updateSearchClearVisibility() {
    if (!filtersForm) return;
    filtersForm.classList.toggle('has-query', Boolean(searchInput.value));
  }

  // ---- Deterministic branded fallback thumbnail (no image on the course) ----
  // Same approach as home.js's fallbackThumb(): a hash of the course's own
  // data picks a geometric layout + hue, so cards stay visually varied and
  // intentional without any external asset or fabricated content.

  function hash(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

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

  function fallbackThumbHtml(course) {
    const seed = hash(course.slug || course.title);
    const v = seed % 4;
    const hue = 258 + ((seed >>> 3) % 5) * 6;
    const lx = 18 + ((seed >>> 5) % 64);
    const ly = 14 + ((seed >>> 9) % 56);
    return `
      <div class="cc-thumb-art cc-art-v${v}" aria-hidden="true" style="--art-hue:${hue};--art-x:${lx}%;--art-y:${ly}%;">
        <span class="cc-art-shape cc-art-shape-a"></span>
        <span class="cc-art-shape cc-art-shape-b"></span>
        <span class="cc-art-initials">${esc(initialsFor(course))}</span>
      </div>`;
  }

  const ARROW_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>';

  // One primary action per card. There is no cart in this codebase, so no
  // Add to Cart / View Cart state exists; purchase happens on course.html.
  function ctaHtml(slug, owned) {
    return owned
      ? `<a class="cc-cta cc-cta-owned" href="learning.html">Go to Learning ${ARROW_SVG}</a>`
      : `<a class="cc-cta" href="course.html?slug=${encodeURIComponent(slug)}">View Course ${ARROW_SVG}</a>`;
  }

  // Best-effort, signed-in only: swap the CTA on courses the student owns.
  // Ownership is display-only; the backend re-checks it on every real action.
  let ownedPromise = null;
  function getOwnedSlugs() {
    if (!ownedPromise) {
      ownedPromise = (async () => {
        try {
          if (typeof Auth === 'undefined' || !(await Auth.init())) return new Set();
          const dash = await Api.get('/students/me/dashboard');
          return new Set((dash.myLearnings || []).map((l) => l.slug).filter(Boolean));
        } catch { return new Set(); }
      })();
    }
    return ownedPromise;
  }
  async function markOwned() {
    const owned = await getOwnedSlugs();
    if (!owned.size) return;
    listEl.querySelectorAll('.cc-card[data-slug]').forEach((card) => {
      if (!owned.has(card.dataset.slug)) return;
      const slot = card.querySelector('.cc-cta-slot');
      if (slot) slot.innerHTML = ctaHtml(card.dataset.slug, true);
    });
  }

  function courseCardHtml(course) {
    const href = `course.html?slug=${encodeURIComponent(course.slug)}`;
    const original = Format.originalPrice(course.pricing);
    const price = Format.price(course.pricing);
    const level = Format.level(course.metadata && course.metadata.level);
    const duration = Format.durationFromMinutes(course.metadata && course.metadata.durationMinutes);
    const pricing = course.pricing;
    const pct = pricing && !pricing.isFree && pricing.basePrice > pricing.salePrice && pricing.basePrice > 0
      ? Math.round((1 - pricing.salePrice / pricing.basePrice) * 100) : 0;
    // Fallback art is pre-rendered (hidden) alongside the <img> whenever a
    // thumbnail URL exists, so a broken/placeholder image (404, blank,
    // "image not included" watermark, etc.) can swap to it instantly via
    // onerror with no flash of missing content and no extra network call.
    const fallbackMarkup = fallbackThumbHtml(course);
    return `
      <article class="cc-card" data-slug="${esc(course.slug)}">
        <a class="cc-thumb" href="${href}" tabindex="-1" aria-hidden="true">
          ${course.thumbnail
            ? `<img src="${esc(course.thumbnail)}" alt="${esc(course.title)}${course.category ? ` — ${esc(course.category.name)} course` : ' — course thumbnail'}" width="640" height="360" loading="lazy" decoding="async" onerror="this.closest('.cc-thumb').classList.add('cc-thumb-broken');this.remove();" />${fallbackMarkup}`
            : fallbackMarkup}
          <div class="cc-badges">
            ${course.category ? `<span class="cc-badge cc-badge-cat">${esc(course.category.name)}</span>` : ''}
            ${level ? `<span class="cc-badge">${esc(level)}</span>` : ''}
          </div>
        </a>
        <div class="cc-body">
          <h3 class="cc-title"><a class="cc-title-link" href="${href}">${esc(course.title)}</a></h3>
          ${course.shortDescription ? `<p class="cc-desc">${esc(Format.truncate(course.shortDescription, 110))}</p>` : ''}
          ${course.instructor || duration ? `<p class="cc-instructor">${[course.instructor && esc(course.instructor.name), duration && esc(duration)].filter(Boolean).join(' · ')}</p>` : ''}
          <div class="cc-foot">
            <span class="cc-price">
              ${price ? `<span class="cc-price-now">${esc(price)}</span>` : ''}
              ${original ? `<span class="cc-price-was">${esc(original)}</span>` : ''}
              ${pct ? `<span class="cc-off">${pct}% off</span>` : ''}
            </span>
            <span class="cc-cta-slot">${ctaHtml(course.slug, false)}</span>
          </div>
        </div>
      </article>`;
  }

  function skeletonCards(n) {
    return Array.from({ length: n })
      .map(
        () => `
        <div class="cc-card cc-skeleton" aria-hidden="true">
          <div class="cc-thumb skeleton"></div>
          <div class="cc-body">
            <span class="skeleton cc-sk-line"></span>
            <span class="skeleton cc-sk-line cc-sk-short"></span>
            <span class="skeleton cc-sk-line cc-sk-meta"></span>
            <span class="skeleton cc-sk-line cc-sk-price"></span>
          </div>
        </div>`
      )
      .join('');
  }

  function renderEmpty() {
    listEl.innerHTML = `
      <div class="cc-state">
        <h3>No courses match your current search.</h3>
        <p>Try a broader keyword, check the spelling, or explore another category.</p>
        <button class="btn btn-outline" id="clear-filters" type="button">Reset filters</button>
      </div>`;
    const clearBtn = document.getElementById('clear-filters');
    if (clearBtn) clearBtn.addEventListener('click', clearFilters);
  }

  function renderCatalogEmpty() {
    listEl.innerHTML = `
      <div class="cc-state">
        <h3>No courses yet</h3>
        <p>New courses will appear here as soon as they are published.</p>
      </div>`;
  }

  function renderError(err) {
    listEl.innerHTML = `
      <div class="cc-state">
        <h3>Unable to load courses right now.</h3>
        <p>${err instanceof TypeError && !navigator.onLine ? 'You appear to be offline. Check your connection and try again.' : 'We couldn\u2019t reach the course catalogue. Please check your connection and try again in a moment.'}</p>
        <button class="btn btn-outline" id="retry-courses" type="button">Try Again</button>
      </div>`;
    const retry = document.getElementById('retry-courses');
    if (retry) retry.addEventListener('click', load);
  }

  function renderPagination(pagination) {
    if (!pagination || pagination.totalPages <= 1) {
      paginationEl.hidden = true;
      return;
    }
    paginationEl.hidden = false;
    paginationStatusEl.textContent = `Page ${pagination.page} of ${pagination.totalPages}`;
    prevPageBtn.disabled = pagination.page <= 1;
    nextPageBtn.disabled = pagination.page >= pagination.totalPages;
  }

  function renderSummary(pagination) {
    if (!pagination || pagination.total === 0) {
      summaryEl.innerHTML = state.search || state.category
        ? `No courses found${state.search ? ` for "${esc(state.search)}"` : ''}.`
        : 'No courses found.';
      return;
    }
    const count = `${pagination.total} course${pagination.total === 1 ? '' : 's'} found`;
    if (state.search) {
      summaryEl.innerHTML = `Search results for "${esc(state.search)}"<span class="cc-summary-sub">${esc(count)}</span>`;
    } else if (state.category && state.categoryName) {
      summaryEl.innerHTML = `${esc(state.categoryName)}<span class="cc-summary-sub">${esc(count)}</span>`;
    } else {
      summaryEl.textContent = pagination.page === 1 ? `All Courses — ${count}` : count;
    }
  }

  // ---- Hero stats: real counts only, added never fabricated -----------------

  function addHeroStat(kind, count) {
    if (!heroStatsEl || !Number.isFinite(count) || count < 1) return;
    if (heroStatsEl.querySelector(`[data-stat="${kind}"]`)) return;
    const label = kind === 'courses'
      ? (count === 1 ? 'course' : 'courses')
      : (count === 1 ? 'category' : 'categories');
    const li = document.createElement('li');
    li.className = 'cc-stat';
    li.setAttribute('data-stat', kind);
    li.innerHTML = `<strong>${esc(count)}</strong><span>${esc(label)}</span>`;
    heroStatsEl.appendChild(li);
    heroStatsEl.hidden = false;
    if (heroStatsSkeletonEl) heroStatsSkeletonEl.hidden = true;
  }

  function addHeroPlainStat(text) {
    if (!heroStatsEl) return;
    const li = document.createElement('li');
    li.className = 'cc-stat cc-stat-plain';
    li.innerHTML = `<span class="cc-stat-dot" aria-hidden="true"></span><span>${esc(text)}</span>`;
    heroStatsEl.appendChild(li);
    heroStatsEl.hidden = false;
    if (heroStatsSkeletonEl) heroStatsSkeletonEl.hidden = true;
  }

  // ---- Category selection: ONE code path for chips AND skill-area cards -------

  /** Reflects state.category onto every category control (chips + skill cards). */
  function syncCategoryUI() {
    document.querySelectorAll('[data-category]').forEach((btn) => {
      const active = (btn.getAttribute('data-category') || '') === state.category;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function scrollToCatalog() {
    if (!catalogEl) return;
    SmoothScroll.scrollTo(catalogEl);
  }

  function selectCategory(id, name, { scroll = false } = {}) {
    state.category = id || '';
    state.categoryName = state.category ? (name || '') : '';
    state.page = 1;
    syncCategoryUI();
    writeStateToUrl();
    load();
    if (scroll) scrollToCatalog();
  }

  function skillCardHtml(c, index) {
    const hue = 250 + (hash(c.id || c.name) % 8) * 8;
    const mark = String(c.name || '').trim().slice(0, 2).toUpperCase() || String(index + 1);
    return `
      <li>
        <button type="button" class="cc-skill${state.category === c.id ? ' is-active' : ''}" data-category="${esc(c.id)}" data-name="${esc(c.name)}" aria-pressed="${state.category === c.id ? 'true' : 'false'}" style="--skill-hue:${hue};">
          <span class="cc-skill-mark" aria-hidden="true">${esc(mark)}</span>
          <span class="cc-skill-name">${esc(c.name)}</span>
          <span class="cc-skill-go" aria-hidden="true">${ARROW_SVG}</span>
          <span class="sr-only">Show ${esc(c.name)} courses</span>
        </button>
      </li>`;
  }

  async function loadCategoryChips() {
    if (!categoryFilterEl) return;
    try {
      const data = await Catalog.listCategories({ sort: 'name', limit: 20 });
      if (!data.items.length) return; // keep hidden

      if (state.category) {
        const match = data.items.find((c) => c.id === state.category);
        if (match) state.categoryName = match.name;
      }

      const allChip = `<button type="button" class="cc-cat-chip${state.category ? '' : ' is-active'}" data-category="" aria-pressed="${state.category ? 'false' : 'true'}">All Courses</button>`;
      const chips = data.items
        .map(
          (c) =>
            `<button type="button" class="cc-cat-chip${state.category === c.id ? ' is-active' : ''}" data-category="${esc(c.id)}" data-name="${esc(c.name)}" aria-pressed="${state.category === c.id ? 'true' : 'false'}">${esc(c.name)}</button>`
        )
        .join('');
      categoryFilterEl.innerHTML = allChip + chips;
      categoryFilterEl.hidden = false;
      if (categoryBlockEl) categoryBlockEl.hidden = false;

      // Skill-area cards: same real categories, same fetch, same state.
      if (skillGridEl) {
        skillGridEl.innerHTML = data.items.map(skillCardHtml).join('');
        skillGridEl.hidden = false;
      }

      // One delegated listener per container (chips + cards share selectCategory).
      const onPick = (scroll) => (e) => {
        const btn = e.target.closest('[data-category]');
        if (!btn) return;
        selectCategory(btn.getAttribute('data-category') || '', btn.getAttribute('data-name') || btn.textContent.trim(), { scroll });
      };
      categoryFilterEl.addEventListener('click', onPick(false));
      if (skillGridEl) skillGridEl.addEventListener('click', onPick(true));

      // Re-sync once the controls exist (state may have changed while loading).
      syncCategoryUI();
      addHeroStat('categories', data.items.length);
    } catch {
      // Category chips are a secondary filter aid; fail silently.
    }
  }

  async function load() {
    listEl.innerHTML = skeletonCards(PAGE_LIMIT);
    summaryEl.textContent = 'Loading courses…';
    try {
      const data = await Catalog.listCourses({
        search: state.search || undefined,
        category: state.category || undefined,
        sort: state.sort,
        page: state.page,
        limit: PAGE_LIMIT,
      });

      if (!data || !Array.isArray(data.items)) throw new Error('malformed');
      if (!data.items.length) {
        if (state.search || state.category) {
          renderEmpty();
        } else {
          renderCatalogEmpty();
        }
        renderSummary(data.pagination);
        renderPagination(data.pagination);
        return;
      }

      listEl.innerHTML = data.items.map(courseCardHtml).join('');
      markOwned();
      renderSummary(data.pagination);
      renderPagination(data.pagination);

      // Only add the course-count hero stat from the unfiltered, first-page
      // load, so it reflects the whole catalog rather than a filtered view.
      if (data.pagination && !state.search && !state.category && state.page === 1) {
        addHeroStat('courses', Number(data.pagination.total));
      }
    } catch (err) {
      renderError(err);
      summaryEl.textContent = '';
      paginationEl.hidden = true;
      // Stats fetch won't resolve either in this case — stop the skeleton
      // shimmer rather than leaving it animating indefinitely.
      if (heroStatsSkeletonEl) heroStatsSkeletonEl.hidden = true;
    }
  }

  function clearFilters() {
    state.search = '';
    state.category = '';
    state.categoryName = '';
    state.page = 1;
    searchInput.value = '';
    updateSearchClearVisibility();
    syncCategoryUI();
    writeStateToUrl();
    load();
  }

  function init() {
    readStateFromUrl();
    searchInput.value = state.search;
    sortSelect.value = state.sort;
    updateSearchClearVisibility();
    addHeroPlainStat('Learn at your pace');

    filtersForm.addEventListener('submit', (e) => {
      e.preventDefault();
      state.search = searchInput.value.trim();
      state.page = 1;
      writeStateToUrl();
      load();
    });

    searchInput.addEventListener('input', updateSearchClearVisibility);

    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        updateSearchClearVisibility();
        searchInput.focus();
        if (state.search) {
          state.search = '';
          state.page = 1;
          writeStateToUrl();
          load();
        }
      });
    }

    sortSelect.addEventListener('change', () => {
      state.sort = sortSelect.value;
      state.page = 1;
      writeStateToUrl();
      load();
    });

    prevPageBtn.addEventListener('click', () => {
      if (state.page <= 1) return;
      state.page -= 1;
      writeStateToUrl();
      load();
      scrollToCatalog();
    });

    nextPageBtn.addEventListener('click', () => {
      state.page += 1;
      writeStateToUrl();
      load();
      scrollToCatalog();
    });

    loadCategoryChips();
    load();
  }

  init();
})();
