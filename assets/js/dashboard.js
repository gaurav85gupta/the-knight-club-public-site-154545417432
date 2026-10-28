/**
 * Dashboard controller — the student's OVERVIEW page.
 *
 * REFACTOR NOTE (Student Area UI/UX refactor)
 * This page used to also contain the full profile, the full "My Learnings"
 * library and the change-password form. Those now live on their own pages:
 *   profile.html / learning.html / change-password.html (via settings.html)
 * The dashboard keeps only: hero, stats, Continue Learning, a compact
 * Recent Activity list and shortcuts.
 *
 * PRESERVED, UNCHANGED:
 * - Auth guard:      const user = await Auth.requireAuth(); Auth.guardBfcache();
 * - One dashboard request: GET /students/me/dashboard (drives stats, Continue
 *   Learning and Recent Activity). Same envelope, same capability flags,
 *   same error handling (Auth.handleSessionError first).
 *
 * ADDED (existing endpoint only): GET /students/orders?page=1&limit=3, used
 * ONLY to add "Course purchased" rows to Recent Activity. It is best-effort:
 * if it fails the dashboard renders normally with learning-only activity.
 * No new endpoint, no API contract change.
 *
 * NO MOCK DATA: every number/row below comes from those two responses.
 * Values the API does not supply (lesson counts, current lesson) are simply
 * not rendered. Activity events are never invented — a row exists only if a
 * real record backs it.
 *
 * All values are written with textContent, never innerHTML.
 */

(async function initDashboard() {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  document.documentElement.classList.remove('auth-pending');

  StudentShell.mount({ user, active: 'dashboard' });

  const { el } = StudentUI;
  const $ = (id) => document.getElementById(id);

  // ---- Hero (real name; time-of-day greeting is display only) -----------------
  const firstName = (user.fullName || '').trim().split(/\s+/)[0] || user.userId;
  $('dash-title').textContent = `${StudentUI.greeting()}, ${firstName}`;

  // ---- Stats -------------------------------------------------------------------
  function renderSummary(summary, capabilities, allItems) {
    const fields = [
      ['summary-total', 'summary-total-note', summary.totalCourses],
      ['summary-in-progress', 'summary-in-progress-note', summary.inProgressCourses],
      ['summary-completed', 'summary-completed-note', summary.completedCourses],
    ];
    for (const [valueId, noteId, value] of fields) {
      const valueEl = $(valueId);
      const noteEl = $(noteId);
      if (typeof value === 'number') {
        valueEl.textContent = String(value);
        noteEl.textContent = '';
      } else {
        // Explicit unavailable state — never a fabricated 0.
        valueEl.textContent = '\u2014';
        noteEl.textContent = capabilities.learningDataAvailable ? '' : 'Not available yet';
      }
    }

    // Overall progress = plain mean of the server's per-course percentages.
    // Shown ONLY when every course carries a real number; otherwise the card
    // stays hidden rather than showing a guess.
    const card = $('stat-overall-card');
    const percents = allItems.map(StudentUI.progressOf);
    if (allItems.length && percents.every((p) => p !== null)) {
      const mean = Math.round(percents.reduce((a, b) => a + b, 0) / percents.length);
      $('summary-overall').textContent = `${mean}%`;
      card.hidden = false;
    } else {
      card.hidden = true;
    }
  }

  // ---- Continue Learning -----------------------------------------------------
  const cont = {
    loading: $('continue-loading'),
    empty: $('continue-empty'),
    error: $('continue-error'),
    card: $('continue-card'),
  };

  function renderContinueLearning(item, capabilities) {
    if (item) {
      cont.card.replaceChildren(featureCard(item));
      StudentUI.showState(cont, 'card');
      $('hero-cta').href = StudentUI.continueHref(item);
      $('hero-cta-label').textContent = 'Continue Learning';
      return;
    }
    if (!capabilities.learningDataAvailable) {
      $('continue-empty-title').textContent = "Learning data isn't available yet.";
      $('continue-empty-message').textContent = 'Continue Learning will appear here once learning activity is available.';
    } else {
      $('continue-empty-title').textContent = "You haven't started any courses yet.";
      $('continue-empty-message').textContent = 'Browse the catalog and start learning something new.';
    }
    StudentUI.showState(cont, 'empty');
  }

  function featureCard(item) {
    const wrap = el('article', 'continue-feature');
    wrap.appendChild(StudentUI.thumb(item, 'continue-feature-thumb'));

    const body = el('div', 'continue-feature-body');
    body.appendChild(el('h3', 'continue-feature-title', item.title || 'Continue your course'));
    if (item.instructor) body.appendChild(el('p', 'learn-card-instructor', `by ${item.instructor}`));
    if (item.source === 'MEMBERSHIP') body.appendChild(StudentUI.memberTag());

    const pct = StudentUI.progressOf(item);
    if (pct !== null) {
      const meta = el('div', 'continue-feature-meta');
      const left = el('span');
      const strong = el('strong', null, `${pct}%`);
      left.append(strong, document.createTextNode(' complete'));
      meta.appendChild(left);
      const counts = StudentUI.lessonCounts(item);
      if (counts) meta.appendChild(el('span', null, `Lesson ${Math.min(counts.done + 1, counts.total)} of ${counts.total}`));
      body.append(meta, StudentUI.progressBar(pct, `${item.title || 'Course'} progress`));
    }
    const lesson = StudentUI.currentLessonTitle(item);
    if (lesson) body.appendChild(el('p', 'learn-card-current', `Up next: ${lesson}`));

    const cta = el('a', 'btn btn-primary btn-lg');
    cta.href = StudentUI.continueHref(item);
    const arrow = el('span', 'btn-arrow', '\u2192');
    arrow.setAttribute('aria-hidden', 'true');
    cta.append('Continue Learning', arrow);
    body.appendChild(cta);

    wrap.appendChild(body);
    return wrap;
  }

  // ---- Recent Activity (real records only) ------------------------------------
  const act = {
    loading: $('activity-loading'),
    empty: $('activity-empty'),
    list: $('activity-list'),
  };

  const ACTIVITY_ICONS = { learning: 1, completed: 1, purchase: 1 };

  function activityRow({ kind, title, meta, href }) {
    const li = el('li', 'activity-item');
    const dot = el('span', 'activity-dot');
    dot.appendChild(StudentShell.svg(ACTIVITY_ICONS[kind] ? kind : 'learning', 18));
    dot.setAttribute('aria-hidden', 'true');

    const text = el('div', 'activity-text');
    const t = el('p', 'activity-title');
    if (href) {
      const a = el('a', null, title);
      a.href = href;
      a.style.color = 'inherit';
      t.appendChild(a);
    } else {
      t.textContent = title;
    }
    text.append(t, el('p', 'activity-meta', meta));
    li.append(dot, text);
    return li;
  }

  function buildActivity(recentLearning, orders) {
    const rows = [];

    for (const item of recentLearning) {
      const bucket = StudentUI.bucketOf(item);
      rows.push({
        kind: bucket === 'completed' ? 'completed' : 'learning',
        title: item.title || 'Untitled course',
        meta: bucket === 'completed' ? 'Course completed' : bucket === 'in-progress' ? 'Lesson activity' : 'Course started',
        href: StudentUI.continueHref(item),
        sort: 0,
      });
    }

    for (const order of orders) {
      // Only PAID orders read as "purchased"; a pending/failed order is not a
      // purchase and must not be presented as one.
      if (order.status !== 'CAPTURED') continue;
      rows.push({
        kind: 'purchase',
        title: (order.course && order.course.title) || 'Course purchased',
        meta: `Course purchased \u00B7 ${StudentUI.formatDateShort(order.createdAt)}`,
        href: `order-detail.html?id=${encodeURIComponent(order.id)}`,
        sort: order.createdAt ? new Date(order.createdAt).getTime() : 0,
      });
    }

    // recentLearning arrives already ordered by the server (most recent first)
    // but carries no timestamp, so it keeps its server order and stays first;
    // dated purchases follow newest-first. We never invent a time for learning rows.
    return rows.slice(0, 5);
  }

  function renderActivity(rows) {
    if (!rows.length) {
      StudentUI.showState(act, 'empty');
      return;
    }
    act.list.replaceChildren(...rows.map(activityRow));
    StudentUI.showState(act, 'list');
  }

  // ---- Phase 3: open pre-booking resume banner ------------------------------------
  // dashboard.membershipBooking is the server's own purchase summary (same
  // shape pre-booking.js renders), or null when there's no open booking.
  // This never overlaps with the 1% Club member badge: a booking summary
  // only exists while the order is still PENDING (see
  // membershipBooking.service.js#getActiveBookingSummary), and isMember is
  // only ever true for a PAID order — the two states are mutually exclusive.
  function renderBookingBanner(booking) {
    const banner = $('dash-booking-banner');
    if (!banner) return;
    if (!booking) {
      banner.hidden = true;
      return;
    }

    const stageMessage = {
      PRE_BOOKING_PENDING_PAYMENT: 'Complete your pre-booking payment to reserve your seat.',
      PRE_BOOKED: 'Your seat is reserved — choose your courses to continue.',
      COURSE_SELECTION_COMPLETE: `Remaining balance: ${StudentUI.money(booking.remainingBalance, booking.currency)}.`,
      REMAINING_PAYMENT_PENDING: `Remaining balance: ${StudentUI.money(booking.remainingBalance, booking.currency)}.`,
    };

    $('dash-booking-sub').textContent = stageMessage[booking.purchaseStage] || 'Continue where you left off.';
    $('dash-booking-resume').href = `pre-booking.html?orderId=${encodeURIComponent(booking.orderId)}`;
    banner.hidden = false;
  }

  // ---- Load ----------------------------------------------------------------------
  async function loadDashboard() {
    StudentUI.showState(cont, 'loading');
    StudentUI.showState(act, 'loading');

    // Orders are fetched best-effort and in parallel; they can never fail the page.
    const ordersPromise = Api.get('/students/orders?page=1&limit=3')
      .then((r) => (r && Array.isArray(r.items) ? r.items : []))
      .catch(() => []);

    try {
      const dashboard = await Api.get('/students/me/dashboard');
      const capabilities = dashboard.capabilities || { learningDataAvailable: false, progressDataAvailable: false };
      const myLearnings = dashboard.myLearnings || [];
      const recent = dashboard.recentLearning || [];

      // 1% Club member badge (server-derived from a PAID membership order).
      if (dashboard.student && dashboard.student.isMember) {
        $('dash-eyebrow').appendChild(el('span', 'member-badge', '1% Club Member'));
      }

      // Phase 3: open pre-booking resume banner — independent of the member
      // badge above (see renderBookingBanner's doc comment).
      renderBookingBanner(dashboard.membershipBooking || null);

      renderSummary(dashboard.summary || {}, capabilities, myLearnings);
      renderContinueLearning(dashboard.continueLearning || null, capabilities);

      const orders = await ordersPromise;
      renderActivity(buildActivity(recent, orders));
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      $('continue-error-message').textContent =
        err instanceof ApiError && err.message ? err.message : "We couldn't load your dashboard right now.";
      StudentUI.showState(cont, 'error');
      StudentUI.showState(act, 'empty');
    }
  }

  $('dash-retry').addEventListener('click', loadDashboard);
  loadDashboard();
})();
