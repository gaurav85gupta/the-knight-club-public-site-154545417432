/**
 * Testimonials page controller.
 *
 * DATA SOURCE: there is currently NO testimonials endpoint in the backend
 * contract, so TESTIMONIALS_ENDPOINT is null and this page makes NO network
 * call. Until a backend exists it reads the owner-supplied feedback in
 * assets/js/testimonials-data.js (window.TESTIMONIALS_SEED); if that is absent
 * or empty it shows an honest empty state. Nothing is invented.
 *
 * When the backend ships a public route, set TESTIMONIALS_ENDPOINT to its path
 * (relative to CONFIG.API_BASE_URL, e.g. '/testimonials'). Expected response:
 *   { items: [{ id, quote, name, role?, course?: {slug,title}, photoUrl?,
 *               rating? (1-5), story?, featured?, createdAt? }],
 *     pagination: { page, totalPages, total } }
 * Only `quote` and `name` are required; every other field is shown ONLY when
 * present and valid. Ratings/courses/photos are never inferred.
 *
 * Optional sections appear only when the data supports them:
 *   featured   -> an item flagged `featured: true` (never auto-picked)
 *   long-form  -> items that carry a `story`
 *   courses    -> distinct real course links from items
 *   themes/filter -> >= 2 distinct `topic` values, >= 6 items, all items loaded
 */
(function () {
  var TESTIMONIALS_ENDPOINT = null;
  var PAGE_LIMIT = 9;

  var esc = function (v) { return Format.escapeHtml(v); };

  function str(v) { return typeof v === 'string' && v.trim() ? v.trim() : ''; }
  function safeUrl(u) { u = str(u); return /^https:\/\//i.test(u) || /^\//.test(u) ? u : ''; }

  /** Keeps only valid, known fields. Returns null if quote or name is missing. */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var quote = str(raw.quote), name = str(raw.name);
    if (!quote || !name) return null;
    var r = Number(raw.rating);
    var course = raw.course && str(raw.course.slug) && str(raw.course.title)
      ? { slug: str(raw.course.slug), title: str(raw.course.title) } : null;
    var d = raw.createdAt ? new Date(raw.createdAt) : null;
    return {
      id: raw.id, quote: quote, name: name, role: str(raw.role), topic: str(raw.topic), program: str(raw.program), course: course,
      photoUrl: safeUrl(raw.photoUrl), story: str(raw.story), featured: raw.featured === true,
      rating: Number.isInteger(r) && r >= 1 && r <= 5 ? r : 0,
      date: d && !isNaN(d) ? d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : ''
    };
  }

  function avatarHtml(t) {
    if (t.photoUrl) return '<span class="tm-avatar"><img src="' + esc(t.photoUrl) + '" alt="Photo of ' + esc(t.name) + '" width="44" height="44" loading="lazy" decoding="async" /></span>';
    return '<span class="tm-avatar tm-avatar-text" aria-hidden="true">' + esc(t.name.charAt(0).toUpperCase()) + '</span>';
  }

  function metaHtml(t) {
    var courseLink = t.course
      ? '<span class="tm-course">Course: <a href="course.html?slug=' + encodeURIComponent(t.course.slug) + '">' + esc(t.course.title) + '</a></span>' : '';
    return '<span class="tm-who"><strong class="tm-name">' + esc(t.name) + '</strong>' +
      (t.role ? '<span class="tm-meta">' + esc(t.role) + '</span>' : '') +
      (t.program ? '<span class="tm-program">' + esc(t.program) + '</span>' : '') + courseLink +
      (t.rating ? '<span class="tm-meta">Rated ' + t.rating + ' out of 5</span>' : '') +
      (t.date ? '<span class="tm-meta">' + esc(t.date) + '</span>' : '') + '</span>';
  }

  function cardHtml(t) {
    return '<article class="tm-card" data-topic="' + esc(t.topic) + '">' +
      '<blockquote class="tm-quote"><p>' + esc(t.quote) + '</p></blockquote>' +
      '<footer class="tm-author">' + avatarHtml(t) + metaHtml(t) + '</footer></article>';
  }

  function featuredHtml(t) {
    return '<figure class="tm-featured-fig"><blockquote class="tm-featured-quote"><p>' + esc(t.quote) + '</p></blockquote>' +
      '<figcaption class="tm-author">' + avatarHtml(t) + metaHtml(t) + '</figcaption></figure>';
  }

  function storyHtml(t) {
    var paras = t.story.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p.trim()) + '</p>'; }).join('');
    return '<article class="tm-story"><header class="tm-story-head">' + avatarHtml(t) + metaHtml(t) + '</header><div class="tm-story-body">' + paras + '</div></article>';
  }

  function coursesHtml(items) {
    var map = {};
    items.forEach(function (t) { if (t.course) { (map[t.course.slug] = map[t.course.slug] || { title: t.course.title, n: 0 }).n++; } });
    return Object.keys(map).map(function (slug) {
      return '<li><a class="tm-course-link" href="course.html?slug=' + encodeURIComponent(slug) + '"><span>' + esc(map[slug].title) +
        '</span><small>' + map[slug].n + (map[slug].n === 1 ? ' story' : ' stories') + '</small></a></li>';
    }).join('');
  }

  function topics(items) {
    var m = {}; items.forEach(function (t) { if (t.topic) m[t.topic] = (m[t.topic] || 0) + 1; }); return m;
  }

  function distinctCourses(items) {
    var m = {}; items.forEach(function (t) { if (t.course) m[t.course.slug] = t.course.title; }); return m;
  }

  /* ---- page wiring (browser only) ---- */
  function init() {
    var $ = function (id) { return document.getElementById(id); };
    var grid = $('stories-grid'); if (!grid) return;
    var empty = $('stories-empty'), stateEl = $('stories-state'), wrap = $('stories-wrap');
    var moreBtn = $('load-more'), filterEl = $('story-filter');
    var all = [], page = 1, totalPages = 1, activeTopic = '';

    function show(id, on) { var n = $(id); if (n) n.hidden = !on; }

    function renderAll() {
      var featured = all.filter(function (t) { return t.featured; })[0] || null;
      var rest = all.filter(function (t) { return t !== featured; });
      show('featured-wrap', !!featured);
      if (featured) $('featured-body').innerHTML = featuredHtml(featured);

      var stories = all.filter(function (t) { return t.story; });
      show('longform-wrap', stories.length > 0);
      if (stories.length) $('longform-body').innerHTML = stories.map(storyHtml).join('');

      var cHtml = coursesHtml(all);
      show('courses-wrap', !!cHtml);
      $('courses-list').innerHTML = cHtml;

      var tp = topics(all), tkeys = Object.keys(tp);
      var themes = tkeys.length >= 2 && all.length >= 6;
      show('themes-wrap', themes);
      if (themes) $('themes-list').innerHTML = tkeys.sort(function (a, b) { return tp[b] - tp[a]; }).map(function (k) {
        return '<li><span>' + esc(k) + '</span><small>' + tp[k] + (tp[k] === 1 ? ' story' : ' stories') + '</small></li>'; }).join('');
      var canFilter = themes && totalPages <= 1;
      filterEl.hidden = !canFilter;
      if (canFilter) {
        filterEl.innerHTML = '<button type="button" class="tm-chip" aria-pressed="' + (activeTopic === '') + '" data-c="">All</button>' +
          tkeys.map(function (k) { return '<button type="button" class="tm-chip" aria-pressed="' + (activeTopic === k) + '" data-c="' + esc(k) + '">' + esc(k) + '</button>'; }).join('');
      } else activeTopic = '';

      var visible = rest.filter(function (t) { return !activeTopic || t.topic === activeTopic; });
      grid.innerHTML = visible.map(cardHtml).join('');
      grid.hidden = visible.length === 0;
      show('stories-wrap', rest.length > 0);
      moreBtn.hidden = page >= totalPages;
    }

    function setState(kind) {
      empty.hidden = kind !== 'empty';
      stateEl.hidden = kind !== 'error' && kind !== 'loading';
      wrap.hidden = kind === 'empty' || kind === 'error' || kind === 'loading';
      if (kind === 'loading') stateEl.innerHTML = '<p class="tm-state-text" role="status">Loading student stories…</p>';
      if (kind === 'error') {
        stateEl.innerHTML = '<div class="tm-error"><h2 class="pub-title">We couldn\u2019t load student stories.</h2><p>Please check your connection and try again.</p><button type="button" class="btn btn-outline" id="tm-retry">Try again</button></div>';
        $('tm-retry').addEventListener('click', function () { all = []; page = 1; load(); });
      }
    }

    async function load() {
      if (!TESTIMONIALS_ENDPOINT) {
        var seed = (typeof window !== 'undefined' && Array.isArray(window.TESTIMONIALS_SEED)) ? window.TESTIMONIALS_SEED : [];
        all = seed.map(normalize).filter(Boolean); totalPages = 1;
        if (!all.length) { setState('empty'); return; }
        stateEl.hidden = true; empty.hidden = true; wrap.hidden = false; renderAll(); return;
      }
      if (!all.length) setState('loading');
      try {
        var data = await Api.get(TESTIMONIALS_ENDPOINT + '?page=' + page + '&limit=' + PAGE_LIMIT);
        if (!data || !Array.isArray(data.items)) throw new Error('malformed');
        all = all.concat(data.items.map(normalize).filter(Boolean));
        totalPages = (data.pagination && Number(data.pagination.totalPages)) || 1;
        if (!all.length) { setState('empty'); return; }
        stateEl.hidden = true; empty.hidden = true; wrap.hidden = false;
        renderAll();
      } catch (e) { setState('error'); }
    }

    filterEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-c]'); if (!b) return;
      activeTopic = b.getAttribute('data-c'); renderAll();
    });
    moreBtn.addEventListener('click', function () { page += 1; load(); });
    load();
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { normalize: normalize, topics: topics, cardHtml: cardHtml, featuredHtml: featuredHtml, storyHtml: storyHtml, coursesHtml: coursesHtml };
  if (typeof document !== 'undefined') init();
})();
