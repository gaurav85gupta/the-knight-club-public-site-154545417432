/**
 * Home page — Skills section video placeholder (Central Placeholders System).
 *
 * Loads the configured "home.skills.video" placeholder from the public API
 * and renders a Bunny embed player (or a graceful fallback) inside
 * #skills-video-wrap, which lives in the "Skills That Move You Forward"
 * section of index.html.
 *
 * -------------------------------------------------------------------------
 * WHAT THIS FILE IS RESPONSIBLE FOR
 * -------------------------------------------------------------------------
 * 1. ONE GET /api/v1/placeholders/home.skills.video call, fired after the
 *    DOM is ready. No polling, no extra requests (spec 22 performance).
 *
 * 2. Four states (spec 18):
 *    LOADING   — skeleton shimmer while the API call is in flight.
 *    CONFIGURED — Bunny embed iframe (16:9, controls, no muted autoplay).
 *    NOT_CONFIGURED / video:null — designed "coming soon" placeholder.
 *    ERROR     — graceful "temporarily unavailable" fallback.
 *
 * 3. Theme support: uses CSS custom properties from tokens.css / site-theme.css.
 *    This file never reads data-site-theme; the CSS does all theming.
 *
 * 4. Secret hygiene: the public API returns only { embedUrl, expiresAt } or
 *    null. No Bunny credential, no videoId, no admin info is ever in this
 *    code or received from the API (spec 23).
 *
 * 5. Does NOT touch: courses, cart, checkout, payment, enrollment, 1% Club,
 *    or any existing home.js function (spec 25).
 *
 * -------------------------------------------------------------------------
 * ARCHITECTURE
 * -------------------------------------------------------------------------
 * Runs as a self-contained IIFE. Depends only on the global `Api` and
 * `CONFIG` objects (from api.js / config.js, already loaded before this
 * file). No new globals are exported.
 *
 * The iframe sandbox intentionally does NOT include allow-scripts because
 * Bunny's own embed URL is a cross-origin iframe — its scripts run in
 * Bunny's own origin context, which is exactly what we want (the video
 * player runs on Bunny's domain, not ours).
 */

(function initSkillsVideo() {
  const PLACEHOLDER_KEY = 'home.skills.video';
  const PLACEHOLDER_TITLE = 'Skills Section Video';

  // ── DOM target ───────────────────────────────────────────────────────────

  const wrap = document.getElementById('skills-video-wrap');
  if (!wrap) return; // section not present on this page — nothing to do

  // Strips/forces off any autoplay the backend's embedUrl may carry in its
  // own query string (e.g. "...?autoplay=true"). The iframe `allow`
  // attribute below only revokes the BROWSER PERMISSION to autoplay — it
  // does nothing about the player itself requesting a muted autoplay, which
  // some browsers grant anyway. Forcing the param off in the URL is what
  // actually stops a visitor landing on the page and a video starting on
  // its own.
  function withAutoplayOff(u) {
    try {
      const parsed = new URL(u);
      parsed.searchParams.set('autoplay', 'false');
      return parsed.toString();
    } catch (e) {
      return u; // malformed URL: rejected upstream before this ever runs
    }
  }

  // ── State renderers ──────────────────────────────────────────────────────

  /**
   * LOADING: animated skeleton that matches the 16:9 card shape so there
   * is no layout shift when the real content arrives.
   */
  function renderLoading() {
    wrap.setAttribute('data-sv-state', 'loading');
    wrap.innerHTML =
      '<div class="sv-skeleton" aria-hidden="true">' +
        '<div class="sv-skeleton-shimmer"></div>' +
      '</div>';
  }

  /**
   * CONFIGURED: signed Bunny embed iframe. 16:9 aspect ratio via padding-
   * bottom trick so the container is sized correctly before the iframe
   * loads. No muted autoplay (spec 19): the browser controls are present
   * so the user decides when to play.
   */
  function renderVideo(embedUrl) {
    wrap.setAttribute('data-sv-state', 'configured');

    // Build the iframe without innerHTML — avoids any XSS risk from a
    // theoretically tampered API response.
    const ratio = document.createElement('div');
    ratio.className = 'sv-ratio';

    const iframe = document.createElement('iframe');
    // embedUrl is a Bunny player URL; set it via attribute, never via
    // innerHTML, to keep it inert until the browser parses it as a URL.
    iframe.setAttribute('src', withAutoplayOff(embedUrl));
    // autoplay intentionally left OUT of `allow` (see "No muted autoplay"
    // note above) — without this permission grant the browser blocks the
    // iframe from autoplaying, so it sits on its first frame until the
    // visitor taps play.
    iframe.setAttribute('allow', 'accelerometer; gyroscope; encrypted-media; picture-in-picture; fullscreen');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('title', PLACEHOLDER_TITLE);
    iframe.className = 'sv-iframe';

    ratio.appendChild(iframe);
    wrap.innerHTML = '';
    wrap.appendChild(ratio);
  }

  /**
   * NOT_CONFIGURED: elegant "video coming soon" placeholder — not an
   * error, just an empty slot. Shows a video camera icon + copy.
   */
  function renderEmpty() {
    wrap.setAttribute('data-sv-state', 'empty');
    wrap.innerHTML =
      '<div class="sv-empty" aria-label="Featured video coming soon">' +
        '<div class="sv-empty-icon" aria-hidden="true">' +
          svgVideoIcon() +
        '</div>' +
        '<p class="sv-empty-title">Featured Video</p>' +
        '<p class="sv-empty-desc">A video for this section will appear here soon.</p>' +
      '</div>';
  }

  /**
   * ERROR: graceful degradation — never breaks the rest of the page.
   * Shown when the API call itself fails (network, server error, etc.).
   * Does NOT show technical error details to the public.
   */
  function renderError() {
    wrap.setAttribute('data-sv-state', 'error');
    wrap.innerHTML =
      '<div class="sv-error" role="status">' +
        '<p>Video temporarily unavailable.</p>' +
      '</div>';
  }

  // ── SVG helper ───────────────────────────────────────────────────────────

  function svgVideoIcon() {
    return (
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="1.4" stroke-linecap="round"' +
      ' stroke-linejoin="round" aria-hidden="true">' +
        '<polygon points="23 7 16 12 23 17 23 7"/>' +
        '<rect x="1" y="5" width="15" height="14" rx="2"/>' +
      '</svg>'
    );
  }

  // ── Fetch + render ────────────────────────────────────────────────────────

  async function load() {
    renderLoading();

    try {
      // GET /api/v1/placeholders/home.skills.video
      // Returns: { key, type, video: { embedUrl, expiresAt } | null }
      // Never includes Bunny credentials (spec 23).
      const data = await Api.get('/placeholders/' + encodeURIComponent(PLACEHOLDER_KEY));

      if (data && data.video && data.video.embedUrl) {
        renderVideo(data.video.embedUrl);
      } else {
        // video: null means "not configured" or "not ready yet" — not an
        // error, just an empty slot. Show the designed placeholder.
        renderEmpty();
      }
    } catch (err) {
      // Any fetch failure (network, 404, 500, etc.) is a graceful fallback,
      // not a page-breaking error. The rest of the home page is unaffected.
      renderError();
    }
  }

  // Start immediately — the script is deferred so the DOM is ready.
  load();
})();