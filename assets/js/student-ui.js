/**
 * StudentUI — small, framework-free renderers shared by the student pages.
 *
 * WHY: `money()`, `formatDate()` and STATUS_LABELS were copy-pasted verbatim
 * into orders.js AND order-detail.js, and the "course card" was built inline
 * in dashboard.js. They now live here once so Dashboard, My Learning and
 * Orders can't drift apart.
 *
 * DATA RULES (from the refactor brief — no mock data, no invented fields):
 * - Every value shown comes from an API response passed in by the caller.
 * - Optional fields (lesson counts, current lesson, instructor...) are
 *   rendered ONLY when the API actually supplied them.
 * - All text is written with textContent. Nothing here uses innerHTML with
 *   data.
 *
 * NOT changed here: progress calculation. `progressPercent` is whatever the
 * server computed; this file only reads it (see `progressOf`).
 */

const StudentUI = (() => {
  const el = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };

  // ---- Formatting (moved verbatim from orders.js / order-detail.js) ---------

  function money(minorUnits, currency) {
    const symbol = currency === 'INR' ? '\u20B9' : `${currency} `;
    const major = (minorUnits / 100).toLocaleString('en-IN', {
      maximumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
    });
    return `${symbol}${major}`;
  }

  function formatDate(iso) {
    if (!iso) return '\u2014';
    return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatDateShort(iso) {
    if (!iso) return '\u2014';
    return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(iso) {
    if (!iso) return '\u2014';
    return new Date(iso).toLocaleString('en-IN', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  const STATUS_LABELS = {
    CAPTURED: 'Paid',
    AUTHORIZED: 'Processing',
    CREATED: 'Pending',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
  };

  /** Status pill. Text label + icon glyph, so status never relies on colour alone. */
  const STATUS_GLYPH = {
    CAPTURED: '\u2713', AUTHORIZED: '\u25CF', CREATED: '\u25CB',
    FAILED: '\u2715', CANCELLED: '\u2715', EXPIRED: '\u25CB',
  };
  function statusBadge(status) {
    const b = el('span', `status-badge status-${status}`);
    const g = el('span', 'status-glyph', STATUS_GLYPH[status] || '\u25CF');
    g.setAttribute('aria-hidden', 'true');
    b.append(g, document.createTextNode(STATUS_LABELS[status] || String(status)));
    return b;
  }

  // ---- Greeting (client clock — display only) --------------------------------
  function greeting(date = new Date()) {
    const h = date.getHours();
    if (h < 5) return 'Good evening';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  // ---- Learning data ----------------------------------------------------------

  /**
   * Reads the server's progress number without inventing one.
   * @returns {number|null} 0-100, or null when the API did not supply a number
   */
  function progressOf(item) {
    if (!item || typeof item.progressPercent !== 'number' || Number.isNaN(item.progressPercent)) return null;
    return Math.max(0, Math.min(100, Math.round(item.progressPercent)));
  }

  /**
   * Buckets a course for the My Learning filter tabs. This is a VIEW over the
   * server's number, not new progress logic:
   *   100 -> completed, 1..99 -> in-progress, 0/unknown -> not started
   * A course with unknown progress is never labelled completed.
   */
  function bucketOf(item) {
    const p = progressOf(item);
    if (p === null) return 'not-started';
    if (p >= 100) return 'completed';
    if (p > 0) return 'in-progress';
    return 'not-started';
  }

  /** Optional lesson counters — only when the API supplied real numbers. */
  function lessonCounts(item) {
    const done = [item.completedLessons, item.lessonsCompleted, item.completedLessonCount].find((v) => typeof v === 'number');
    const total = [item.totalLessons, item.lessonCount, item.lessonsTotal].find((v) => typeof v === 'number');
    if (typeof done === 'number' && typeof total === 'number' && total > 0) return { done, total };
    return null;
  }

  /** Optional "current lesson" title — only when the API supplied one. */
  function currentLessonTitle(item) {
    const cand = item.currentLesson && typeof item.currentLesson === 'object' ? item.currentLesson.title : item.currentLessonTitle;
    return typeof cand === 'string' && cand.trim() ? cand.trim() : '';
  }

  /**
   * Where "Continue" goes. `learn.html` needs a course id; if the API item
   * carries one we open the real player, otherwise we keep the EXISTING
   * behaviour (the course page by slug). Access is enforced by the backend
   * on learn.html's own API call either way — this only picks a link.
   */
  function continueHref(item) {
    const id = item.courseId || item.id;
    if (id) return `learn.html?courseId=${encodeURIComponent(id)}`;
    return item.slug ? `course.html?slug=${encodeURIComponent(item.slug)}` : 'courses.html';
  }

  function thumb(item, className) {
    const wrap = el('div', className);
    if (item.thumbnail) {
      const img = document.createElement('img');
      img.src = item.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.remove();
        wrap.appendChild(fallbackThumb(item));
      });
      wrap.appendChild(img);
    } else {
      wrap.appendChild(fallbackThumb(item));
    }
    return wrap;
  }

  function fallbackThumb(item) {
    const f = el('div', 'thumb-fallback', (item.title || '?').charAt(0).toUpperCase());
    f.setAttribute('aria-hidden', 'true');
    return f;
  }

  function progressBar(pct, label) {
    const track = el('div', 'progress-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(pct));
    track.setAttribute('aria-label', label || 'Course progress');
    const fill = el('div', 'progress-fill');
    // Animate from 0 -> pct on next frame (respects reduced-motion via CSS).
    fill.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${pct}%`; }));
    track.appendChild(fill);
    return track;
  }

  /**
   * Premium learning card used by My Learning (grid) and Dashboard (compact).
   * @param {object} item  one record from the dashboard API
   */
  function learningCard(item) {
    const bucket = bucketOf(item);
    const pct = progressOf(item);
    const card = el('article', `learn-card is-${bucket}`);

    const media = thumb(item, 'learn-card-thumb');
    if (bucket === 'completed') {
      const done = el('span', 'learn-card-ribbon');
      const g = el('span', null, '\u2713');
      g.setAttribute('aria-hidden', 'true');
      done.append(g, document.createTextNode(' Completed'));
      media.appendChild(done);
    }

    const body = el('div', 'learn-card-body');
    const title = el('h3', 'learn-card-title', item.title || 'Untitled course');
    body.appendChild(title);
    if (item.instructor) body.appendChild(el('p', 'learn-card-instructor', `by ${item.instructor}`));

    if (pct !== null) {
      const row = el('div', 'learn-card-progress-row');
      row.appendChild(el('span', 'learn-card-pct', bucket === 'completed' ? 'Completed' : `${pct}% complete`));
      const counts = lessonCounts(item);
      if (counts) row.appendChild(el('span', 'learn-card-lessons', `${counts.done} / ${counts.total} lessons`));
      body.appendChild(row);
      body.appendChild(progressBar(pct, `${item.title || 'Course'} progress`));
    }

    const lessonTitle = bucket === 'in-progress' ? currentLessonTitle(item) : '';
    if (lessonTitle) body.appendChild(el('p', 'learn-card-current', `Up next: ${lessonTitle}`));

    const cta = el('a', bucket === 'completed' ? 'btn btn-outline btn-sm learn-card-cta' : 'btn btn-primary btn-sm learn-card-cta');
    cta.href = continueHref(item);
    // Completed courses reuse the same real destination; the label is the
    // only thing that differs. No "review" feature is implied or invented.
    cta.textContent = bucket === 'completed' ? 'Revisit course' : (bucket === 'not-started' ? 'Start learning' : 'Continue learning');
    const arrow = el('span', 'btn-arrow', '\u2192');
    arrow.setAttribute('aria-hidden', 'true');
    cta.appendChild(arrow);
    body.appendChild(cta);

    card.append(media, body);
    return card;
  }

  // ---- State switching ---------------------------------------------------------
  /**
   * Shows exactly one named state among `states` ({name: element}).
   */
  function showState(states, name) {
    for (const [key, node] of Object.entries(states)) {
      if (node) node.hidden = key !== name;
    }
  }

  /** N skeleton cards, for grids while loading. */
  function skeletonCards(n = 3) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i += 1) {
      const c = el('div', 'learn-card learn-card-skeleton');
      c.setAttribute('aria-hidden', 'true');
      c.append(el('div', 'skeleton skeleton-thumb'), el('div', 'skeleton skeleton-line'), el('div', 'skeleton skeleton-line short'));
      frag.appendChild(c);
    }
    return frag;
  }

  /** Small inline toast (no site toast system exists; this stays out of the way). */
  function toast(message, kind = 'success') {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = el('div', 'toast-host');
      host.id = 'toast-host';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const t = el('div', `toast toast-${kind}`, message);
    host.appendChild(t);
    setTimeout(() => t.classList.add('is-leaving'), 4200);
    setTimeout(() => t.remove(), 4700);
  }

  return {
    el, money, formatDate, formatDateShort, formatDateTime, STATUS_LABELS, statusBadge,
    greeting, progressOf, bucketOf, lessonCounts, currentLessonTitle, continueHref,
    thumb, progressBar, learningCard, showState, skeletonCards, toast,
  };
})();
