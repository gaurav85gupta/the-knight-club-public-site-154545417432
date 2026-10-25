/**
 * Testimonials page controller.
 *
 * DATA SOURCE (Phase 5): GET /testimonials (relative to CONFIG.API_BASE_URL),
 * the shared public Testimonials API — see
 * backend/src/controllers/publicTestimonial.controller.js for the DTO this
 * reads. The server response is unwrapped by Api.get() to its `data` field,
 * i.e. { items, pagination } (see assets/js/api.js). The server already
 * guarantees every item is PUBLISHED; this file does no status filtering.
 *
 * DTO fields actually sent by the backend (toPublicTestimonialDto):
 *   id, name, role, quote, story, topic, program, photoUrl, featured,
 *   createdAt, type ('PHOTO'|'VIDEO'|'WRITTEN').
 *   course?  a course id string, not {slug,title} — there is no
 *            course-title lookup here, so a course reference is tracked but
 *            not rendered as a link; nothing is invented to fill in a title.
 *   video?   { embedUrl, expiresAt } — present only for type === 'VIDEO'.
 * There is no `rating` field at all — the backend model does not have one,
 * so it is never read or shown.
 *
 * Only `quote` and `name` are required; every other field is shown ONLY when
 * present and valid. Ratings/courses/photos are never inferred.
 *
 * Optional sections appear only when the data supports them:
 *   featured   -> an item flagged `featured: true` (never auto-picked)
 *   long-form  -> items that carry a `story`
 *   courses    -> distinct real course links from items (only when a title
 *                 is actually known, which the current DTO never supplies)
 *   themes/filter -> >= 2 distinct `topic` values, >= 6 items, all items loaded
 */
(function () {
  var TESTIMONIALS_ENDPOINT = '/testimonials';
  var PAGE_LIMIT = 9;

  var esc = function (v) { return Format.escapeHtml(v); };

  // Same host safelist used for the 1% Club intro video (one-percent.js) —
  // the real security is the server-side signature, this is defence in depth
  // before an embedUrl is ever used as an iframe src.
  var BUNNY_EMBED_HOST_RE = /^https:\/\/(iframe\.mediadelivery\.net|bunnycdn\.com)\//;

  function str(v) { return typeof v === 'string' && v.trim() ? v.trim() : ''; }
  // Accepts only: (a) a well-formed https URL, or (b) a genuine site-relative
  // path starting with exactly ONE slash followed by a non-slash character.
  // "//evil.example/x.png" is a PROTOCOL-RELATIVE URL — the browser resolves
  // it against the current scheme (https:), so it is a full cross-origin URL
  // to attacker infrastructure, not a relative path on this site. The old
  // /^\//.test(u) check matched it (it does start with "/"), which is the
  // bug this fixes: a second leading slash (or a backslash, which some
  // browsers also treat as a path separator) is rejected outright, and
  // anything else is checked with the real URL parser rather than a
  // same-origin-implying regex, so a malformed string can never slip through
  // as if it were a safe absolute URL.
  function safeUrl(u) {
    u = str(u);
    if (!u) return '';
    if (/^\/[^/\\]/.test(u)) return u; // single-slash relative path only
    if (!/^https:\/\//i.test(u)) return '';
    try {
      var parsed = new URL(u);
      return parsed.protocol === 'https:' ? u : '';
    } catch (e) {
      return '';
    }
  }
  function safeEmbedUrl(u) { u = str(u); return BUNNY_EMBED_HOST_RE.test(u) ? u : ''; }

  /**
   * Keeps only valid, known fields. Returns null if quote or name is missing.
   *
   * `course` on the live API is a bare id string (see file header) — not the
   * {slug,title} shape this page can link to — so it is intentionally NOT
   * mapped into `course` here; course links are only built from testimonials
   * that genuinely carry both a slug and a title.
   */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var quote = str(raw.quote), name = str(raw.name);
    if (!quote || !name) return null;
    var r = Number(raw.rating);
    var course = raw.course && typeof raw.course === 'object' && str(raw.course.slug) && str(raw.course.title)
      ? { slug: str(raw.course.slug), title: str(raw.course.title) } : null;
    var d = raw.createdAt ? new Date(raw.createdAt) : null;
    var type = str(raw.type).toUpperCase();
    // A signed embedUrl is only valid until expiresAt. If it's already
    // past that — or expiresAt is missing/unparseable, which we can't
    // tell apart from "already expired" — the Bunny player renders its
    // own "403 Forbidden" page inside the iframe instead of video: a
    // dead, broken-looking dark box rather than no video at all. An
    // iframe's onload fires for that 403 response too (it's still a
    // successfully-delivered page as far as the browser is concerned),
    // so onload can't be used to catch this after the fact — the only
    // reliable guard is to never point the iframe at a URL we aren't
    // confident is still live. Treating "no expiresAt" as "expired"
    // (fail closed) rather than "assume it's fine" (fail open) is the
    // deliberate choice here: a missing video is just a missing video
    // (clean fallback below), where a guessed-wrong "still valid" is
    // the exact dark 403 box this exists to prevent.
    var exp = raw.video && typeof raw.video === 'object' ? Date.parse(raw.video.expiresAt) : NaN;
    var notExpired = !isNaN(exp) && exp > Date.now();
    var video = (type === 'VIDEO' && raw.video && typeof raw.video === 'object' && notExpired && safeEmbedUrl(raw.video.embedUrl))
      ? { embedUrl: safeEmbedUrl(raw.video.embedUrl) } : null;
    return {
      id: raw.id, quote: quote, name: name, role: str(raw.role), topic: str(raw.topic), program: str(raw.program), course: course,
      type: type, photoUrl: type === 'PHOTO' ? safeUrl(raw.photoUrl) : '', video: video,
      story: str(raw.story), featured: raw.featured === true,
      rating: Number.isInteger(r) && r >= 1 && r <= 5 ? r : 0,
      date: d && !isNaN(d) ? d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : ''
    };
  }

  function avatarHtml(t) {
    if (t.photoUrl) return '<span class="tm-avatar"><img src="' + esc(t.photoUrl) + '" alt="Photo of ' + esc(t.name) + '" width="44" height="44" loading="lazy" decoding="async" /></span>';
    return '<span class="tm-avatar tm-avatar-text" aria-hidden="true">' + esc(t.name.charAt(0).toUpperCase()) + '</span>';
  }

  /** VIDEO testimonials get an embedded iframe above the quote; everything else is unchanged.
      The iframe starts hidden behind a themed placeholder (a play icon on
      the card's own surface color) and only becomes visible once it has
      actually loaded — this keeps the slot looking like part of the card
      in both themes instead of a bare dark rectangle while the player
      (or an error inside it) is still rendering. A cross-origin iframe's
      onload fires for a 403 response too, since that's still a
      successfully-delivered page as far as the browser is concerned, so
      this intentionally doesn't try to detect that case — it only
      guards against the box ever showing its raw, un-skinned dark
      background before something has rendered into it. */
  function videoHtml(t) {
    if (!t.video) return '';
    // autoplay intentionally left OUT of `allow` — without this permission
    // grant the browser blocks the iframe from autoplaying, so the video
    // just sits on the placeholder/first frame until the visitor taps play.
    // (Bunny's own embed may still *request* autoplay; omitting the
    // permission is what actually stops it, not a query param on the URL.)
    // onload: mark the iframe loaded AND hide the placeholder sibling
    // directly via JS (belt-and-suspenders alongside the CSS :has()
    // rule in testimonials.css) — on any browser without :has() support
    // the placeholder would otherwise keep sitting on top of the iframe
    // and silently swallow taps meant for the player's own play/pause/
    // mute controls, which is worst on mobile where everything is tap-
    // driven. previousElementSibling is the .tm-video-placeholder div,
    // always rendered immediately before this iframe.
    return '<div class="tm-video-embed">' +
      '<div class="tm-video-placeholder" aria-hidden="true"><span class="tm-video-play">&#9658;</span></div>' +
      '<iframe src="' + esc(t.video.embedUrl) + '" loading="lazy" allow="accelerometer; gyroscope; encrypted-media; picture-in-picture;" allowfullscreen title="Video testimonial from ' + esc(t.name) + '" onload="this.classList.add(\'is-loaded\'); if (this.previousElementSibling) { this.previousElementSibling.style.display = \'none\'; }"></iframe>' +
      '</div>';
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
      videoHtml(t) +
      '<blockquote class="tm-quote"><p>' + esc(t.quote) + '</p></blockquote>' +
      '<footer class="tm-author">' + avatarHtml(t) + metaHtml(t) + '</footer></article>';
  }

  /** Featured card: media (video, or photo if present, or nothing) in a
      fixed-size left column; quote + author stacked in the right column.
      Mirrors .tm-card's structure so it never grows past card proportions,
      no matter how long the quote text is. */
  function featuredMediaHtml(t) {
    if (t.video) return videoHtml(t);
    if (t.photoUrl) return '<div class="tm-featured-photo"><img src="' + esc(t.photoUrl) + '" alt="Photo of ' + esc(t.name) + '" loading="lazy" decoding="async" /></div>';
    return '';
  }

  function featuredHtml(t) {
    var media = featuredMediaHtml(t);
    return '<figure class="tm-featured-fig' + (media ? '' : ' tm-featured-fig--no-media') + '">' +
      (media ? '<div class="tm-featured-media">' + media + '</div>' : '') +
      '<div class="tm-featured-content">' +
      '<blockquote class="tm-featured-quote"><p>' + esc(t.quote) + '</p></blockquote>' +
      '<figcaption class="tm-author">' + avatarHtml(t) + metaHtml(t) + '</figcaption>' +
      '</div></figure>';
  }

  function storyHtml(t) {
    var paras = t.story.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p.trim()) + '</p>'; }).join('');
    return '<article class="tm-story"><header class="tm-story-head">' + avatarHtml(t) + metaHtml(t) + '</header>' + videoHtml(t) + '<div class="tm-story-body">' + paras + '</div></article>';
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