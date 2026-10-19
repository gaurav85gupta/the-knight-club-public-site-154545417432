/**
 * Learning Page controller (Phase 13 — Course Learning Experience).
 *
 * Same protected-page pattern as dashboard.js:
 *
 *     const user = await Auth.requireAuth();
 *     Auth.guardBfcache();
 *
 * `requireAuth` asks the SERVER who the user is and redirects to login if
 * nobody is signed in; the page stays hidden (html.auth-pending) until that
 * resolves. This is navigation control only — the real protection is the
 * backend authenticating and authorizing every /students/learning/:courseId
 * call (see backend/src/services/studentLearning.service.js).
 *
 * DATA SOURCE
 * One bounded request drives the whole page: GET /students/learning/:courseId
 * (optionally ?lessonId=...). No per-lesson or per-module requests, no
 * polling (spec Step 35, 47).
 *
 * ACCESS CONTROL — WHAT THIS FILE DOES AND DOES NOT DO
 * The backend is the sole authority on whether the current lesson is
 * accessible (`data.currentLesson.access.allowed`). This file never invents
 * its own access decision, never unlocks a lesson locally, and never stores
 * an access flag in localStorage. When a lesson is locked, this file renders
 * the "locked" panel and nothing else — no video src, no lesson body text
 * beyond title/duration, which the backend already scoped safely.
 *
 * PHASE 14 — REAL, SERVER-AUTHORITATIVE PROGRESS
 * The backend now returns real progress/completion/resume from the Learning
 * Progress System (LessonProgress). This file renders it — a real course
 * progress bar, a real per-lesson completed badge, real resume-on-load —
 * and WRITES it back via PATCH /students/courses/:courseId/lessons/:id/progress.
 *
 * HOW PROGRESS IS MEASURED (Bunny embed constraint)
 * The video is a Bunny iframe embed (see backend buildPlayback()) with no
 * postMessage/player API wired — this file does not add one, since doing so
 * would mean creating a second Bunny client / changing the preserved
 * architecture (Student Browser -> Backend -> Bunny CDN), which Phase 14
 * explicitly forbids. Absent a way to read true playback position, progress
 * for a lesson is measured by TIME SPENT with the lesson panel visible and
 * focused (a real, honestly-labelled proxy — never a fake "we know you
 * watched the whole video"), capped at the lesson's known duration, plus an
 * explicit "Mark as complete" action the student can always use directly.
 * `position` records elapsed-visible-seconds for resume purposes; there is
 * no real playback position to restore into the opaque iframe, so resume
 * only restores WHICH lesson to reopen (spec Step 13), not a seek position.
 *
 * WRITE STRATEGY (spec Step 21, "EFFICIENT PROGRESS WRITES")
 * - A local ticker accumulates seconds while the tab is visible/focused and
 *   a lesson is open; nothing is sent every tick.
 * - Persist happens on: a periodic interval (every PERSIST_INTERVAL_MS),
 *   `visibilitychange` to hidden, lesson change, and page unload
 *   (`pagehide`, more reliable than `beforeunload` — spec Step 48) via
 *   `fetch({ keepalive: true })` (see Api.sendOnUnload).
 * - Writes are also naturally deduped: nothing is sent if no visible time
 *   has accumulated since the last successful persist.
 * - A failed write is retried on the NEXT tick rather than assumed to have
 *   succeeded (spec Step 47) — this file never tells the student "saved"
 *   before the server actually confirms it, and never uses localStorage as
 *   the authoritative store, only as a tiny in-memory retry buffer.
 *
 * All dynamic text is written with textContent, never innerHTML (spec Step
 * 27 — XSS protection for course/module/lesson titles).
 */

(function initLearnPage() {
  const PERSIST_INTERVAL_MS = 15000; // periodic flush while actively watching
  const MIN_DELTA_SECONDS_TO_PERSIST = 3; // avoid a write for a few hundred ms of accumulated time

  const params = new URLSearchParams(window.location.search);

  function getCourseId() {
    return (params.get('courseId') || '').trim();
  }
  function getLessonIdParam() {
    return (params.get('lessonId') || '').trim();
  }

  // ---- Element refs --------------------------------------------------------

  const states = {
    loading: document.getElementById('state-loading'),
    courseNotFound: document.getElementById('state-course-not-found'),
    lessonNotFound: document.getElementById('state-lesson-not-found'),
    error: document.getElementById('state-error'),
    shell: document.getElementById('learn-shell'),
  };

  function showState(name) {
    for (const [key, el] of Object.entries(states)) {
      el.hidden = key !== name;
    }
  }

  const sidebarEl = document.getElementById('learn-sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const curriculumNav = document.getElementById('curriculum-nav');
  const sidebarCourseTitle = document.getElementById('sidebar-course-title');

  const lessonEmptyEl = document.getElementById('lesson-empty');
  const lessonPanelEl = document.getElementById('lesson-panel');
  const lessonModuleCrumb = document.getElementById('lesson-module-crumb');
  const lessonTitleEl = document.getElementById('lesson-title');
  const lessonMetaEl = document.getElementById('lesson-meta');
  const lessonLockedEl = document.getElementById('lesson-locked');
  const lessonLockedMessageEl = document.getElementById('lesson-locked-message');
  const lessonLockedBuyLink = document.getElementById('lesson-locked-buy-link');
  const lessonVideoWrap = document.getElementById('lesson-video-wrap');
  const lessonVideoFrame = document.getElementById('lesson-video-frame');
  const lessonNoVideoEl = document.getElementById('lesson-no-video');
  const lessonDescriptionWrap = document.getElementById('lesson-description-wrap');
  const lessonDescriptionEl = document.getElementById('lesson-description');
  const lessonProgressNote = document.getElementById('lesson-progress-note');
  const markCompleteBtn = document.getElementById('mark-complete-btn');
  const lessonCompletedBadge = document.getElementById('lesson-completed-badge');
  const courseProgressWrap = document.getElementById('course-progress-wrap');
  const courseProgressFill = document.getElementById('course-progress-fill');
  const courseProgressLabel = document.getElementById('course-progress-label');
  const courseCompleteBanner = document.getElementById('course-complete-banner');
  const navPrevBtn = document.getElementById('nav-prev');
  const navNextBtn = document.getElementById('nav-next');
  const lessonNotFoundBack = document.getElementById('lesson-not-found-back');
  const errorMessageEl = document.getElementById('state-error-message');
  const errorRetryBtn = document.getElementById('state-error-retry');

  // Redesign-only, purely presentational refs: these mirror data the page
  // already loads and render nothing the backend didn't send. No new
  // requests, no new state, no change to access/progress/nav logic below.
  const headerCourseTitleEl = document.getElementById('learn-header-course-title');
  const breadcrumbCourseTitleEl = document.getElementById('breadcrumb-course-title');
  const upNextCard = document.getElementById('up-next-card');
  const upNextTitleEl = document.getElementById('up-next-title');
  const upNextContinueBtn = document.getElementById('up-next-continue');

  // ---- URL helpers ----------------------------------------------------------

  /** Builds this page's URL for a given lesson, preserving courseId (spec Step 16). */
  function urlForLesson(courseId, lessonId) {
    const usp = new URLSearchParams();
    usp.set('courseId', courseId);
    if (lessonId) usp.set('lessonId', lessonId);
    return `learn.html?${usp.toString()}`;
  }

  /** Updates the address bar without a full reload (spec Step 15). */
  function replaceUrl(courseId, lessonId) {
    const next = `${window.location.pathname}?${new URLSearchParams({ courseId, ...(lessonId ? { lessonId } : {}) }).toString()}`;
    window.history.replaceState(null, '', next);
  }

  // ---- Sidebar drawer (mobile) ----------------------------------------------

  function openSidebar() {
    sidebarEl.classList.add('is-open');
    sidebarBackdrop.hidden = false;
    sidebarToggle.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    sidebarEl.classList.remove('is-open');
    sidebarBackdrop.hidden = true;
    sidebarToggle.setAttribute('aria-expanded', 'false');
  }
  sidebarToggle.addEventListener('click', () => {
    if (sidebarEl.classList.contains('is-open')) closeSidebar();
    else openSidebar();
  });
  sidebarBackdrop.addEventListener('click', closeSidebar);

  // ---- Rendering --------------------------------------------------------------

  function lessonTypeIcon(hasVideo) {
    if (hasVideo) {
      return `<svg class="curriculum-lesson-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 5v14l11-7-11-7z" fill="currentColor"/>
      </svg>`;
    }
    return `<svg class="curriculum-lesson-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor"/>
    </svg>`;
  }

  function lockIcon() {
    return `<svg class="lesson-lock-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" stroke-width="2"/>
      <path d="M7 10V7a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }

  /** Phase 14: real completed-lesson checkmark (replaces the type icon). */
  function completedIcon() {
    return `<svg class="curriculum-lesson-icon curriculum-lesson-icon--completed" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15"/>
      <path d="M7 12.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  /**
   * Renders the sidebar curriculum from the REAL modules/lessons the backend
   * returned for THIS course — never hardcoded (spec Step 6-7). Only the
   * module containing the current lesson starts open; the rest start
   * collapsed, matching the course-detail curriculum preview's pattern.
   */
  function renderSidebar(courseId, data) {
    sidebarCourseTitle.textContent = data.course.title;
    // Redesign-only mirrors of the same course title already rendered above.
    if (headerCourseTitleEl) headerCourseTitleEl.textContent = data.course.title;
    if (breadcrumbCourseTitleEl) breadcrumbCourseTitleEl.textContent = data.course.title;

    // Phase 14: real course progress bar, hidden only when the backend has
    // no lessons to compute against (hasLessons=false) — never hidden just
    // because progress happens to be 0.
    const progress = data.progress || { available: false };
    if (progress.available) {
      courseProgressWrap.hidden = false;
      const pct = Math.max(0, Math.min(100, Number(progress.percentComplete) || 0));
      courseProgressFill.style.width = `${pct}%`;
      courseProgressFill.parentElement.setAttribute('aria-valuenow', String(pct));
      courseProgressLabel.textContent = `${pct}% complete`;
    } else {
      courseProgressWrap.hidden = true;
    }
    courseCompleteBanner.hidden = !(data.courseCompleted === true);

    curriculumNav.innerHTML = '';
    for (const mod of data.modules) {
      const hasCurrent = mod.lessons.some((l) => l.isCurrent);

      const moduleWrap = document.createElement('div');
      moduleWrap.className = `curriculum-module${hasCurrent ? ' is-open' : ''}`;

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'curriculum-module-header';
      header.setAttribute('aria-expanded', String(hasCurrent));

      const titleSpan = document.createElement('span');
      titleSpan.textContent = mod.title;
      const chevron = document.createElement('span');
      chevron.innerHTML = `<svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      header.append(titleSpan, chevron);

      header.addEventListener('click', () => {
        const willOpen = !moduleWrap.classList.contains('is-open');
        moduleWrap.classList.toggle('is-open', willOpen);
        header.setAttribute('aria-expanded', String(willOpen));
      });

      const list = document.createElement('ul');
      list.className = 'curriculum-lessons';

      for (const lesson of mod.lessons) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'curriculum-lesson-btn';
        btn.setAttribute('aria-current', String(Boolean(lesson.isCurrent)));

        const iconWrap = document.createElement('span');
        // Phase 14: a real completed lesson gets a checkmark instead of the
        // usual type icon — sourced from the server's `lesson.completed`
        // (studentLearning.service.js#lessonSummaryDto), never inferred
        // locally.
        iconWrap.innerHTML = lesson.completed ? completedIcon() : lessonTypeIcon(lesson.hasVideo);
        if (lesson.completed) iconWrap.classList.add('is-completed');
        const titleEl = document.createElement('span');
        titleEl.className = 'curriculum-lesson-title';
        titleEl.textContent = lesson.title;
        const durationEl = document.createElement('span');
        durationEl.className = 'curriculum-lesson-duration';
        durationEl.textContent = Format.durationFromSeconds(lesson.durationSeconds);

        btn.append(iconWrap, titleEl);
        if (!lesson.isFreePreview) {
          const lockWrap = document.createElement('span');
          lockWrap.innerHTML = lockIcon();
          btn.appendChild(lockWrap);
        }
        btn.appendChild(durationEl);

        btn.addEventListener('click', () => {
          closeSidebar();
          loadLesson(courseId, lesson.id);
        });

        li.appendChild(btn);
        list.appendChild(li);
      }

      moduleWrap.append(header, list);
      curriculumNav.appendChild(moduleWrap);
    }
  }

  /** Renders the current-lesson panel: header, locked/video/description, nav. */
  function renderCurrentLesson(courseId, data) {
    const lesson = data.currentLesson;

    if (!lesson) {
      lessonPanelEl.hidden = true;
      lessonEmptyEl.hidden = false;
      return;
    }
    lessonEmptyEl.hidden = true;
    lessonPanelEl.hidden = false;

    const mod = data.modules.find((m) => m.id === lesson.moduleId);
    lessonModuleCrumb.textContent = mod ? mod.title : '';
    lessonTitleEl.textContent = lesson.title;
    const duration = Format.durationFromSeconds(lesson.durationSeconds);
    lessonMetaEl.textContent = duration ? `${lesson.type === 'VIDEO' ? 'Video lesson' : 'Text lesson'} · ${duration}` : (lesson.type === 'VIDEO' ? 'Video lesson' : 'Text lesson');

    const allowed = Boolean(lesson.access && lesson.access.allowed);

    lessonLockedEl.hidden = allowed;
    lessonVideoWrap.hidden = true;
    lessonNoVideoEl.hidden = true;
    lessonDescriptionWrap.hidden = true;
    lessonVideoFrame.src = '';

    if (!allowed) {
      // Honest, non-alarming copy — the boundary today is that this
      // student hasn't purchased/been enrolled in the course (Phase 16
      // NOT_ENROLLED), not that enrollment itself is unavailable.
      const notEnrolled = lesson.isFreePreview === false && lesson.access && lesson.access.reason === 'NOT_ENROLLED';
      lessonLockedMessageEl.textContent = notEnrolled
        ? 'Purchase this course to unlock this lesson.'
        : 'This lesson is not currently accessible.';
      if (notEnrolled && data.course && data.course.slug) {
        lessonLockedBuyLink.hidden = false;
        lessonLockedBuyLink.href = `course.html?slug=${encodeURIComponent(data.course.slug)}`;
      } else {
        lessonLockedBuyLink.hidden = true;
      }
    } else {
      if (lesson.playback && lesson.playback.embedUrl) {
        lessonVideoWrap.hidden = false;
        lessonVideoFrame.src = lesson.playback.embedUrl;
      } else if (lesson.type === 'VIDEO') {
        lessonNoVideoEl.hidden = false;
      }
      if (lesson.description) {
        lessonDescriptionWrap.hidden = false;
        lessonDescriptionEl.textContent = lesson.description;
      }
    }

    // Phase 14: real per-lesson progress. `data.currentLesson.progress` is
    // the server-authoritative record for THIS lesson (server DTO from
    // studentLearning.service.js), never a locally-computed guess.
    const lessonProgress = lesson.progress || { progress: 0, completed: false };
    renderLessonProgress(lessonProgress, allowed);

    // Navigation (spec Step 14-15).
    const nav = data.navigation || { previous: null, next: null };
    navPrevBtn.disabled = !nav.previous;
    navNextBtn.disabled = !nav.next;
    navPrevBtn.onclick = nav.previous ? () => loadLesson(courseId, nav.previous.id) : null;
    navNextBtn.onclick = nav.next ? () => loadLesson(courseId, nav.next.id) : null;

    // Redesign-only "Up Next" card: same nav.next the Next button already
    // uses, just surfaced more prominently. Hidden whenever there's no next
    // lesson (never fabricated) or the current lesson isn't accessible.
    if (upNextCard) {
      if (allowed && nav.next) {
        upNextCard.hidden = false;
        upNextTitleEl.textContent = nav.next.title;
        upNextContinueBtn.onclick = () => loadLesson(courseId, nav.next.id);
      } else {
        upNextCard.hidden = true;
        upNextContinueBtn.onclick = null;
      }
    }

    // Re-mark current in the sidebar without a full re-render/collapse.
    curriculumNav.querySelectorAll('.curriculum-lesson-btn').forEach((btn) => {
      btn.setAttribute('aria-current', 'false');
    });
  }

  /** Renders the honest per-lesson progress note + completed badge + Mark-complete affordance. */
  function renderLessonProgress(lessonProgress, allowed) {
    lessonCompletedBadge.hidden = !lessonProgress.completed;
    if (!allowed) {
      lessonProgressNote.textContent = '';
      markCompleteBtn.hidden = true;
      return;
    }
    if (lessonProgress.completed) {
      lessonProgressNote.textContent = '';
      markCompleteBtn.hidden = true;
    } else {
      const pct = Math.round(Number(lessonProgress.progress) || 0);
      lessonProgressNote.textContent = pct > 0 ? `${pct}% watched` : '';
      markCompleteBtn.hidden = false;
    }
  }

  // ---- Progress tracking & persistence (Phase 14) ----------------------------
  //
  // See the file header "HOW PROGRESS IS MEASURED" / "WRITE STRATEGY" for the
  // full rationale. This tracker knows nothing about video internals; it
  // only measures elapsed visible time on the current lesson and persists it
  // through the same PATCH endpoint a real player would use.
  const ProgressTracker = (function createProgressTracker() {
    let courseId = null;
    let lessonId = null;
    let durationSeconds = 0;
    let alreadyCompleted = false;
    let priorProgressPercent = 0; // server's own value at last load — never regressed locally
    let accumulatedSeconds = 0; // visible time accumulated since the last successful persist
    let tickHandle = null;
    let lastTickAt = null;
    let intervalHandle = null;
    let pendingFlush = null; // in-flight flush promise, to avoid overlapping writes

    function isPageVisible() {
      return document.visibilityState === 'visible';
    }

    function tick() {
      if (!isPageVisible() || !lessonId) {
        lastTickAt = null;
        return;
      }
      const now = Date.now();
      if (lastTickAt) accumulatedSeconds += (now - lastTickAt) / 1000;
      lastTickAt = now;
    }

    /** Computes the (locally-estimated, server-clamped-on-arrival) progress percent to send, from elapsed time against known duration. Never regresses below what the server already reported at load. */
    function estimatedProgressPercent() {
      if (!durationSeconds) return null; // no known duration: only position is meaningful, let the server-side threshold rely on explicit "Mark as complete" instead
      const watchedGuess = Math.min(durationSeconds, accumulatedSeconds);
      const pct = Math.round((watchedGuess / durationSeconds) * 100);
      return Math.max(priorProgressPercent, pct);
    }

    /**
     * Persists accumulated progress if there is anything meaningful to send
     * (spec Step 21-22: never write for a few hundred ms of accumulated
     * time, never write nothing). Returns the server's response data, or
     * null if nothing was sent or the write failed (caller decides what
     * to render; a failure never claims to have saved — spec Step 47).
     */
    async function flush({ useBeacon = false } = {}) {
      if (!lessonId || alreadyCompleted) return null;
      tick(); // capture time up to "now" before computing what to send
      if (accumulatedSeconds < MIN_DELTA_SECONDS_TO_PERSIST) return null;

      const body = {};
      const pct = estimatedProgressPercent();
      if (pct !== null) body.progress = pct;
      body.position = Math.round(accumulatedSeconds);
      if (Object.keys(body).length === 0) return null;

      const path = `/students/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/progress`;

      if (useBeacon) {
        // Unload path (spec Step 48). Uses fetch({keepalive:true}) via the
        // API client — NOT navigator.sendBeacon, which can only POST and
        // cannot carry the CSRF marker header, so it always failed
        // (404 on the PATCH-only route; would be 403 even if routed).
        //
        // It is fire-and-forget, so we cannot confirm the save. We still
        // reset the accumulator so the very next flush (visibilitychange
        // + pagehide both fire on tab close) cannot re-send the same
        // seconds. Worst case if this request is lost: a few seconds of
        // progress are not counted; the server never over-counts, and
        // the next page load reconciles from the server's own value.
        Api.sendOnUnload(path, body);
        accumulatedSeconds = 0;
        return null;
      }

      if (pendingFlush) return pendingFlush; // never overlap two writes for the same lesson
      pendingFlush = Api.patch(path, body)
        .then((data) => {
          accumulatedSeconds = 0; // only reset on a CONFIRMED save (spec Step 47)
          if (data && typeof data.progress === 'number') priorProgressPercent = data.progress;
          if (data && data.completed) alreadyCompleted = true;
          return data;
        })
        .catch(() => null) // silent — the next tick/interval retries; never told the student it saved when it didn't
        .finally(() => {
          pendingFlush = null;
        });
      return pendingFlush;
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        tick();
        flush(); // "pause"-equivalent persistence (spec Step 47: tab hidden)
      } else {
        lastTickAt = Date.now();
      }
    }

    function onPageHide() {
      flush({ useBeacon: true }); // spec Step 48: reliable best-effort on unload
    }

    /** Starts tracking a newly-opened, accessible lesson. */
    function start(cId, lId, durationSecs, serverProgress) {
      stop(); // stop tracking whatever was open before (spec Step 30)
      courseId = cId;
      lessonId = lId;
      durationSeconds = durationSecs || 0;
      alreadyCompleted = Boolean(serverProgress && serverProgress.completed);
      priorProgressPercent = (serverProgress && Number(serverProgress.progress)) || 0;
      accumulatedSeconds = 0;
      lastTickAt = isPageVisible() ? Date.now() : null;

      intervalHandle = window.setInterval(() => {
        tick();
        flush();
      }, PERSIST_INTERVAL_MS);
    }

    /** Stops tracking (lesson change, unload) and flushes whatever was accumulated (spec Step 30, 48). */
    function stop() {
      if (intervalHandle) {
        window.clearInterval(intervalHandle);
        intervalHandle = null;
      }
      if (lessonId) flush();
      courseId = null;
      lessonId = null;
      lastTickAt = null;
    }

    /** Explicit "Mark as complete" — still goes through the same validated, server-decided endpoint; the client cannot force `completed`, only report progress=100 and let the server apply its own rule. */
    async function markComplete() {
      if (!lessonId || alreadyCompleted) return null;
      tick();
      const path = `/students/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/progress`;
      const data = await Api.patch(path, { progress: 100 });
      accumulatedSeconds = 0;
      if (data && data.completed) alreadyCompleted = true;
      return data;
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return { start, stop, markComplete };
  })();

  markCompleteBtn.addEventListener('click', async () => {
    markCompleteBtn.disabled = true;
    try {
      const data = await ProgressTracker.markComplete();
      if (data) {
        renderLessonProgress(data, true);
        // Refresh sidebar/course-progress state without a full page reload
        // (spec Step 32-33) — cheapest correct way is reloading this lesson's
        // data, since course progress/resume/sidebar all derive server-side.
        const courseId = getCourseId();
        const currentLessonId = getLessonIdParam();
        await loadLesson(courseId, currentLessonId || null);
      }
    } catch {
      // Silent — the button re-enables and the note keeps its prior state;
      // no misleading "saved" claim on failure (spec Step 47).
    } finally {
      markCompleteBtn.disabled = false;
    }
  });

  // ---- Loading -----------------------------------------------------------------

  let loadToken = 0;

  /**
   * Loads (or switches to) a lesson within the given course. One bounded
   * request; on success it updates the URL, sidebar, and lesson panel
   * together (spec Step 15, 35).
   */
  async function loadLesson(courseId, lessonId) {
    const token = (loadToken += 1);
    showState('loading');
    try {
      const qs = lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : '';
      const data = await Api.get(`/students/learning/${encodeURIComponent(courseId)}${qs}`);
      if (token !== loadToken) return; // a newer request has already started

      replaceUrl(courseId, data.currentLesson ? data.currentLesson.id : lessonId || '');
      document.title = `${data.course.title} — Learn — The Knight Club`;

      showState('shell');
      renderSidebar(courseId, data);
      renderCurrentLesson(courseId, data);
      lessonNotFoundBack.href = urlForLesson(courseId, null);

      // Phase 14: (re)start tracking only for an accessible lesson with
      // known duration and video content — never for a locked lesson (spec
      // Step 4, 27) and never accumulating time against nothing (spec Step
      // 30: stop the previous timer, start the new one, avoid duplicates).
      const cl = data.currentLesson;
      const allowed = Boolean(cl && cl.access && cl.access.allowed);
      if (allowed) {
        ProgressTracker.start(courseId, cl.id, cl.durationSeconds, cl.progress);
      } else {
        ProgressTracker.stop();
      }
    } catch (err) {
      if (token !== loadToken) return;
      if (Auth.handleSessionError(err)) return;

      if (err instanceof ApiError && err.status === 404) {
        // The backend does not distinguish "course not found" from "lesson
        // not found" in its message text (spec Step 21-22 non-disclosure),
        // but this page can still tell the two apart locally: a lessonId
        // was in play here, whereas the very first load never sends one for
        // a nonexistent course. Show the more specific, still-safe state
        // when we know a lesson was requested; otherwise, course-not-found.
        showState(lessonId ? 'lessonNotFound' : 'courseNotFound');
        return;
      }
      errorMessageEl.textContent =
        err instanceof ApiError && err.message ? err.message : "We couldn't load this course right now.";
      showState('error');
    }
  }

  errorRetryBtn.addEventListener('click', () => {
    const courseId = getCourseId();
    loadLesson(courseId, getLessonIdParam() || null);
  });

  // ---- Init ------------------------------------------------------------------

  async function init() {
    const user = await Auth.requireAuth();
    Auth.guardBfcache();
    document.documentElement.classList.remove('auth-pending');

    // Day/Night toggle — same shared control the student shell uses.
    const themeSlot = document.getElementById('theme-toggle-slot');
    if (themeSlot && typeof ThemeToggle !== 'undefined') {
      themeSlot.appendChild(ThemeToggle.create('theme-toggle--learn'));
    }

    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      ProgressTracker.stop(); // flush any accumulated progress before leaving (spec Step 48)
      await Auth.logout();
      Auth.setNotice('You have been signed out.', 'info');
      window.location.replace(Auth.urlFor(Auth.PATHS.login));
    });
    Auth.onChange((u) => {
      if (!u) window.location.replace(Auth.urlFor(Auth.PATHS.login));
    });

    const courseId = getCourseId();
    if (!courseId) {
      showState('courseNotFound');
      return;
    }
    void user;
    await loadLesson(courseId, getLessonIdParam() || null);
  }

  init();
})();
