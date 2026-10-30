/**
 * Homepage testimonials (Phase 6.1).
 *
 * Replaces the section's former hardcoded markup (three fixed named
 * testimonials with specific unverified outcome claims) with the SAME
 * shared public Testimonials API every other testimonial surface on this
 * site reads: GET /testimonials — see
 * backend/src/controllers/publicTestimonial.controller.js for the DTO, and
 * assets/js/testimonials.js / assets/js/one-percent.js for the sibling
 * consumers of this exact endpoint. There is no separate homepage
 * collection, no separate endpoint, and nothing here is invented: an
 * empty or failed API response hides the section rather than falling back
 * to any built-in content.
 *
 * SCOPE: this is a small, fixed-size teaser (a handful of cards + a "Read
 * More Stories" link to pages/testimonials.html, which has its own full
 * pagination/filtering), not a second implementation of that page's
 * features (load-more, topic filter, long-form stories). It only needs:
 * quote, name, role, photoUrl, featured — the same fields the teaser
 * always showed.
 */
(function () {
  var TESTIMONIALS_ENDPOINT = '/testimonials';
  // Small, fixed teaser — the site's full story list lives on
  // pages/testimonials.html, linked via "Read More Stories" below.
  var TEASER_LIMIT = 6;

  var esc = function (v) { return Format.escapeHtml(v); };

  // Same host safelist used by assets/js/testimonials.js — the real
  // security is the server-side signature, this is defence in depth
  // before an embedUrl is ever used as an iframe src.
  var BUNNY_EMBED_HOST_RE = /^https:\/\/(iframe\.mediadelivery\.net|bunnycdn\.com)\//;

  function str(v) { return typeof v === 'string' && v.trim() ? v.trim() : ''; }

  // Same safe-URL discipline as assets/js/testimonials.js#safeUrl: only a
  // well-formed https URL, or a genuine single-slash site-relative path.
  // The public DTO's photoUrl is already resolved server-side (see
  // publicTestimonial.controller.js#resolvePhotoUrl) to an absolute https
  // CDN URL or '' — this is defence in depth, not the primary guarantee.
  function safeUrl(u) {
    u = str(u);
    if (!u) return '';
    if (/^\/[^/\\]/.test(u)) return u;
    if (!/^https:\/\//i.test(u)) return '';
    try {
      return new URL(u).protocol === 'https:' ? u : '';
    } catch (e) {
      return '';
    }
  }

  // Forces autoplay off in the embed URL's own query string — same reason
  // as testimonials.js#withAutoplayOff: the iframe's `allow` attribute
  // alone doesn't stop a muted autoplay some browsers grant anyway.
  function withAutoplayOff(u) {
    try {
      var parsed = new URL(u);
      parsed.searchParams.set('autoplay', 'false');
      return parsed.toString();
    } catch (e) {
      return u;
    }
  }
  function safeEmbedUrl(u) { u = str(u); return BUNNY_EMBED_HOST_RE.test(u) ? withAutoplayOff(u) : ''; }

  /** Keeps only valid, known fields. Returns null if quote or name is missing. */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var quote = str(raw.quote), name = str(raw.name);
    if (!quote || !name) return null;
    var type = str(raw.type).toUpperCase();
    // Same fail-closed expiry guard as testimonials.js: a signed embedUrl
    // is only good until expiresAt. Missing/unparseable expiresAt is
    // treated as already-expired rather than assumed still valid, so the
    // homepage teaser never points an iframe at a dead signed URL.
    var exp = raw.video && typeof raw.video === 'object' ? Date.parse(raw.video.expiresAt) : NaN;
    var notExpired = !isNaN(exp) && exp > Date.now();
    var video = (type === 'VIDEO' && raw.video && typeof raw.video === 'object' && notExpired && safeEmbedUrl(raw.video.embedUrl))
      ? { embedUrl: safeEmbedUrl(raw.video.embedUrl) } : null;
    return {
      quote: quote,
      name: name,
      role: str(raw.role),
      photoUrl: type === 'PHOTO' ? safeUrl(raw.photoUrl) : '',
      video: video,
      featured: raw.featured === true,
    };
  }

  function avatarHtml(t) {
    if (t.photoUrl) {
      return '<span class="tm-avatar"><img src="' + esc(t.photoUrl) + '" alt="Photo of ' + esc(t.name) + '" width="44" height="44" loading="lazy" decoding="async" /></span>';
    }
    return '<span class="tm-avatar tm-avatar-text" aria-hidden="true">' + esc(t.name.charAt(0).toUpperCase()) + '</span>';
  }

  /** Same pattern as testimonials.js#videoHtml: iframe hidden behind a
      themed placeholder until it actually loads, so the slot never shows
      a bare dark rectangle while the player is still rendering. */
  function videoHtml(t) {
    if (!t.video) return '';
    return '<div class="tm-video-embed">' +
      '<div class="tm-video-placeholder" aria-hidden="true"><span class="tm-video-play">&#9658;</span></div>' +
      '<iframe src="' + esc(t.video.embedUrl) + '" loading="lazy" allow="accelerometer; gyroscope; encrypted-media; picture-in-picture;" allowfullscreen title="Video testimonial from ' + esc(t.name) + '" onload="this.classList.add(\'is-loaded\'); if (this.previousElementSibling) { this.previousElementSibling.style.display = \'none\'; }"></iframe>' +
      '</div>';
  }

  function cardHtml(t) {
    return '<article class="tm-card">' +
      videoHtml(t) +
      '<blockquote class="tm-quote"><p>' + esc(t.quote) + '</p></blockquote>' +
      '<footer class="tm-author">' + avatarHtml(t) +
      '<span class="tm-who"><strong class="tm-name">' + esc(t.name) + '</strong>' +
      (t.role ? '<span class="tm-meta">' + esc(t.role) + '</span>' : '') +
      '</span></footer></article>';
  }

  async function init() {
    var section = document.getElementById('testimonials');
    var grid = document.getElementById('home-tm-grid');
    var stateEl = document.getElementById('home-tm-state');
    var moreEl = document.getElementById('home-tm-more');
    if (!section || !grid || !stateEl || !moreEl) return;

    function hideSection() {
      section.hidden = true;
    }

    function showEmptyOrError() {
      // No hardcoded fallback content (spec: never substitute invented
      // testimonials): the section simply does not appear when the API
      // has nothing published yet, or could not be reached.
      hideSection();
    }

    var items;
    try {
      var data = await Api.get(TESTIMONIALS_ENDPOINT + '?page=1&limit=' + TEASER_LIMIT);
      if (!data || !Array.isArray(data.items)) throw new Error('malformed');
      items = data.items.map(normalize).filter(Boolean);
    } catch (e) {
      showEmptyOrError();
      return;
    }

    if (!items.length) {
      showEmptyOrError();
      return;
    }

    // Featured testimonials first (an operator's explicit curation choice),
    // same ordering preference as pages/testimonials.html's featured slot,
    // then whatever order the API already returned the rest in.
    items.sort(function (a, b) { return (b.featured === true) - (a.featured === true); });

    grid.innerHTML = items.map(cardHtml).join('');
    grid.hidden = false;
    stateEl.hidden = true;
    moreEl.hidden = false;
    section.hidden = false;
  }

  init();
})();