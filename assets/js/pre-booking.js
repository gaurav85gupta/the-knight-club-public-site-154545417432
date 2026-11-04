/**
 * pre-booking.js — 1% Club Pre-Booking Journey (Phase 3)
 *
 * FLOW
 * ----
 * ?orderId=<id> in the URL identifies the booking. If absent, this page
 * creates/resumes the booking for the plan named in ?slug=<slug> (the
 * public 1% Club page links here after calling PreBookingApi.createOrResume
 * itself; this fallback exists so a bookmarked/shared link with only a slug
 * still works).
 *
 * Every screen is driven entirely by GET .../purchase (the server's
 * authoritative purchase summary) — specifically `purchaseStage` and
 * `nextAction`. This file does NOT re-derive lifecycle state; it only
 * renders whatever the server reports and wires the one action the current
 * stage allows (pay pre-booking / select courses / pay remaining balance).
 *
 * PAYMENT (shared with checkout-page.js's architecture, same endpoints):
 *   1. POST /payments/order-payments  { orderId } — amount/purpose decided
 *      server-side from the order's current stage (see
 *      membershipBooking.service.js#resolveStagedPaymentIntent). This
 *      file never sends or displays an amount it invented.
 *   2. Razorpay Checkout opens with the server-provided params.
 *   3. Success callback -> POST /payments/order-payments/verify. Treated as
 *      UNVERIFIED client-side; only the backend's response (and the next
 *      purchase-summary refresh) decides what the UI shows.
 *   4. After verify (success OR uncertain), this page ALWAYS re-fetches the
 *      purchase summary and re-renders from it — never assumes the stage
 *      advanced just because Checkout reported success.
 *   5. Dismiss -> best-effort POST /payments/order-payments/cancel, mirroring
 *      checkout-page.js.
 *
 * A pre-booking is never shown as an activated membership. The only panel
 * that says "you're a member" is the FULLY_PAID panel, and it renders only
 * when the server's own `membershipActive` flag is true.
 */

'use strict';

/* global Auth, Api, ApiError, StudentShell, StudentUI, CONFIG, PreBookingApi */

(async () => {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  document.documentElement.classList.remove('auth-pending');

  if (typeof StudentShell !== 'undefined') StudentShell.mount({ user, active: 'orders' });

  const { el, money } = StudentUI;

  const dom = {
    alert:            document.getElementById('pb-alert'),
    loading:          document.getElementById('pb-loading'),
    error:            document.getElementById('pb-error'),
    errorMessage:     document.getElementById('pb-error-message'),
    errorRetry:       document.getElementById('pb-error-retry'),
    notFound:         document.getElementById('pb-notfound'),
    content:          document.getElementById('pb-content'),
    pageTitle:        document.getElementById('pb-page-title'),
    stageStrip:       document.getElementById('pb-stage-strip'),
    anomalyBanner:    document.getElementById('pb-anomaly-banner'),
    awaitingBanner:   document.getElementById('pb-awaiting-banner'),
    sidebar:          document.getElementById('pb-sidebar'),
    summaryFields:    document.getElementById('pb-summary-fields'),
    paymentBtn:       document.getElementById('pb-payment-btn'),
    paymentBtnText:   document.getElementById('pb-payment-btn-text'),
    paymentNotice:    document.getElementById('pb-payment-notice'),
    paymentNoticeText:document.getElementById('pb-payment-notice-text'),
    paymentError:     document.getElementById('pb-payment-error'),
    // Panels
    panelPayPre:      document.getElementById('pb-panel-pay-prebooking'),
    ppMembershipPrice:document.getElementById('pb-pp-membership-price'),
    ppAmount:         document.getElementById('pb-pp-amount'),
    panelSelect:      document.getElementById('pb-panel-select-courses'),
    selectSub:        document.getElementById('pb-select-sub'),
    selectCount:      document.getElementById('pb-select-count'),
    selectGrid:       document.getElementById('pb-select-grid'),
    selectError:       document.getElementById('pb-select-error'),
    selectSave:       document.getElementById('pb-select-save'),
    panelComplete:    document.getElementById('pb-panel-courses-complete'),
    completeSub:      document.getElementById('pb-complete-sub'),
    completeList:     document.getElementById('pb-complete-list'),
    completeEdit:     document.getElementById('pb-complete-edit'),
    panelPayRemaining:document.getElementById('pb-panel-pay-remaining'),
    prMembershipPrice:document.getElementById('pb-pr-membership-price'),
    prCaptured:       document.getElementById('pb-pr-captured'),
    prRemaining:      document.getElementById('pb-pr-remaining'),
    panelFullyPaid:   document.getElementById('pb-panel-fully-paid'),
    fpOrderLink:      document.getElementById('pb-fp-order-link'),
  };

  const ALL_PANELS = [
    dom.panelPayPre, dom.panelSelect, dom.panelComplete, dom.panelPayRemaining, dom.panelFullyPaid,
  ];

  let currentOrderId = null;
  let currentPurchase = null;
  let planCoursesById = null; // lazily loaded only when course selection is shown
  let isPaymentInFlight = false;
  let isSelectionInFlight = false;

  // ---- Top-level state machine --------------------------------------------
  function showState(name) {
    dom.loading.hidden  = name !== 'loading';
    dom.error.hidden    = name !== 'error';
    dom.notFound.hidden = name !== 'notfound';
    dom.content.hidden  = name !== 'content';
  }

  function showPanel(panelEl) {
    for (const p of ALL_PANELS) p.hidden = p !== panelEl;
  }

  // ---- Stage strip ----------------------------------------------------------
  const STAGE_SEQUENCE = [
    { key: 'PRE_BOOKING_PENDING_PAYMENT', label: 'Reserve seat' },
    { key: 'PRE_BOOKED', label: 'Confirmed' },
    { key: 'COURSE_SELECTION_COMPLETE', label: 'Choose courses' },
    { key: 'REMAINING_PAYMENT_PENDING', label: 'Pay balance' },
    { key: 'FULLY_PAID', label: 'Member' },
  ];
  // PRE_BOOKED and COURSE_SELECTION_COMPLETE collapse into one visual step
  // ("Choose courses") since both precede course selection being finished;
  // this index map decides each stage's position in STAGE_SEQUENCE.
  const STAGE_INDEX = {
    PRE_BOOKING_PENDING_PAYMENT: 0,
    PRE_BOOKED: 2,
    COURSE_SELECTION_COMPLETE: 2,
    REMAINING_PAYMENT_PENDING: 3,
    FULLY_PAID: 4,
  };

  function renderStageStrip(stage) {
    const currentIdx = STAGE_INDEX[stage] != null ? STAGE_INDEX[stage] : 0;
    dom.stageStrip.replaceChildren(
      ...STAGE_SEQUENCE.map((s, idx) => {
        const li = el('li', idx < currentIdx ? 'is-done' : idx === currentIdx ? 'is-current' : null);
        const dot = el('span', 'pb-stage-dot');
        dot.setAttribute('aria-hidden', 'true');
        li.append(dot, document.createTextNode(s.label));
        return li;
      })
    );
  }

  // ---- Payment button helpers (mirrors checkout-page.js) -------------------
  function setPaymentProcessing(label) {
    isPaymentInFlight = true;
    dom.paymentBtn.disabled = true;
    dom.paymentBtn.setAttribute('aria-disabled', 'true');
    dom.paymentBtnText.textContent = label || 'Processing…';
    dom.paymentNoticeText.textContent = label || 'Processing…';
    dom.paymentNotice.hidden = false;
    dom.paymentError.hidden = true;
  }

  function resetPaymentBtn(label) {
    isPaymentInFlight = false;
    dom.paymentBtn.disabled = false;
    dom.paymentBtn.removeAttribute('aria-disabled');
    dom.paymentBtnText.textContent = label || 'Pay now';
    dom.paymentNotice.hidden = true;
  }

  function showPaymentError(message) {
    resetPaymentBtn();
    dom.paymentError.textContent = message || 'Payment could not be completed. Please try again.';
    dom.paymentError.hidden = false;
  }

  /**
   * Mirrors checkout-page.js's dismiss-block countdown: shown when the
   * backend reports the student has dismissed Checkout too many times on
   * this order and must wait before retrying.
   */
  function startDismissBlockCountdown(remainingMs) {
    isPaymentInFlight = true;
    dom.paymentBtn.disabled = true;
    dom.paymentBtn.setAttribute('aria-disabled', 'true');

    function formatTime(ms) {
      const totalSec = Math.max(0, Math.ceil(ms / 1000));
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    const deadline = Date.now() + remainingMs;
    function tick() {
      const left = deadline - Date.now();
      if (left <= 0) {
        dom.paymentError.hidden = true;
        resetPaymentBtn();
        return;
      }
      dom.paymentError.textContent = `Too many attempts. Please wait ${formatTime(left)} before trying again.`;
      dom.paymentError.hidden = false;
      dom.paymentBtnText.textContent = `Wait ${formatTime(left)}`;
      setTimeout(tick, 1000);
    }
    tick();
  }

  function loadRazorpayScript() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="checkout.razorpay.com"]');
      if (existing) {
        existing.addEventListener('load', resolve);
        existing.addEventListener('error', () => reject(new Error('Could not load payment provider.')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load the payment provider. Please check your connection.'));
      document.head.appendChild(script);
    });
  }

  /**
   * Starts a Razorpay payment attempt for the CURRENT order. The backend
   * decides amount/purpose from the order's own stage — this function
   * never passes or assumes either. After any outcome (verified, failed,
   * dismissed) the purchase summary is reloaded so the UI always reflects
   * the server's own view of what happened.
   */
  async function initiatePayment() {
    if (isPaymentInFlight || !currentOrderId) return;

    dom.paymentError.hidden = true;
    setPaymentProcessing('Preparing payment…');

    let checkoutData;
    try {
      const [, result] = await Promise.all([
        loadRazorpayScript(),
        PreBookingApi.createPayment(currentOrderId),
      ]);
      checkoutData = result;
    } catch (err) {
      if (err instanceof ApiError) {
        if (Auth.handleSessionError(err)) return;
        if (err.errorCode === 'CHECKOUT_DISMISS_BLOCKED') {
          const retryAfter = err.details && err.details.retryAfter;
          const remainingMs = retryAfter ? new Date(retryAfter).getTime() - Date.now() : 30 * 60 * 1000;
          startDismissBlockCountdown(Math.max(remainingMs, 1000));
          return;
        }
        // The order moved on (already paid / awaiting confirmation / needs
        // course selection first) — reload the summary so the UI catches up
        // rather than show a stale "Pay now" button.
        if (err.status === 409) {
          await loadPurchase(currentOrderId, { silent: true });
          showPaymentError(err.message || 'This booking has changed. Please review the page.');
          return;
        }
        showPaymentError(err.message || 'Could not start payment. Please try again.');
      } else {
        showPaymentError('Could not start payment. Please try again.');
      }
      return;
    }

    const { checkout } = checkoutData;
    setPaymentProcessing('Opening payment window…');

    const options = {
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amount,
      currency: checkout.currency,
      name: 'The Knight Club',
      description: `1% Club — ${currentPurchase ? currentPurchase.orderNumber : 'Pre-Booking'}`,
      notes: currentPurchase ? { orderNumber: currentPurchase.orderNumber } : {},
      handler: async function handleRazorpaySuccess(response) {
        setPaymentProcessing('Confirming payment…');
        try {
          await PreBookingApi.verifyPayment({
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });
        } catch (err) {
          // Even on a verify error, re-check the authoritative summary below
          // before giving up — a webhook may have already settled this.
          if (err instanceof ApiError && Auth.handleSessionError(err)) return;
        }
        await loadPurchase(currentOrderId, { silent: true });
        resetPaymentBtn();
      },
      modal: {
        ondismiss: async function handleDismiss() {
          try {
            const cancelResult = await PreBookingApi.cancelPayment(checkout.orderId);
            const blockedUntil = cancelResult && cancelResult.order && cancelResult.order.checkoutBlockedUntil;
            if (blockedUntil) {
              const unblockMs = new Date(blockedUntil).getTime() - Date.now();
              if (unblockMs > 0) {
                startDismissBlockCountdown(unblockMs);
                return;
              }
            }
          } catch (err) {
            // Best-effort; the server sweeper reclaims a stale attempt.
            // eslint-disable-next-line no-console
            console.warn('[pre-booking] cancel-on-dismiss failed:', err && err.message);
          }
          resetPaymentBtn();
        },
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', function handlePaymentFailed(response) {
      const message = (response && response.error && response.error.description) ||
        'Payment could not be completed. Please try again.';
      showPaymentError(message);
    });

    rzp.open();
  }

  // ---- Summary sidebar -------------------------------------------------------
  function renderSummarySidebar(p) {
    const currency = p.currency || 'INR';
    const rows = [
      ['Membership price', money(p.membershipPrice, currency)],
    ];
    if (p.preBookingAmount != null) {
      rows.push(['Pre-booking amount', money(p.preBookingAmount, currency)]);
    }
    rows.push(['Paid so far', money(p.verifiedCapturedTotal, currency)]);
    if (p.purchaseStage !== 'FULLY_PAID') {
      rows.push(['Remaining balance', money(p.remainingBalance, currency)]);
    }

    dom.summaryFields.replaceChildren(
      ...rows.map(([label, value]) => {
        const row = el('div', 'cart-summary-row');
        row.append(el('dt', null, label), el('dd', null, value));
        return row;
      })
    );

    // Payment CTA visibility/label is driven entirely by nextAction.
    if (p.nextAction === 'PAY_PRE_BOOKING') {
      dom.paymentBtn.hidden = false;
      dom.paymentBtnText.textContent = `Pay ${money(p.preBookingAmount, currency)}`;
    } else if (p.nextAction === 'PAY_REMAINING_BALANCE') {
      dom.paymentBtn.hidden = false;
      dom.paymentBtnText.textContent = `Pay ${money(p.remainingBalance, currency)}`;
    } else {
      dom.paymentBtn.hidden = true;
    }

    dom.awaitingBanner.hidden = p.nextAction !== 'AWAIT_PAYMENT_CONFIRMATION';
    dom.anomalyBanner.hidden = !p.requiresSupportReview;
  }

  // ---- Panel: pay pre-booking -------------------------------------------------
  function renderPayPreBooking(p) {
    const currency = p.currency || 'INR';
    dom.ppMembershipPrice.textContent = money(p.membershipPrice, currency);
    dom.ppAmount.textContent = money(p.preBookingAmount, currency);
    showPanel(dom.panelPayPre);
  }

  // ---- Panel: select courses --------------------------------------------------
  // Course data for the picker comes from the PUBLIC plan endpoint (same one
  // one-percent.js already uses) — this page never invents a course list.
  // The purchase summary identifies the plan by id, not by its public slug,
  // so the slug is carried in `?slug=` (set by the 1% Club page's link, or
  // by this page itself once it loads — see boot()/render()).
  async function loadPlanCourses() {
    if (planCoursesById) return planCoursesById;
    // Prefer the authoritative booking-time slug from the purchase summary
    // (works from any entry point, e.g. the dashboard resume link, which
    // does not carry ?slug=). Fall back to the URL param for older cached
    // responses or odd navigation paths.
    const slug = (currentPurchase && currentPurchase.planSlug) || window.__pbPlanSlug;
    if (!slug) {
      planCoursesById = new Map();
      return planCoursesById;
    }
    const plan = await Api.get(`/memberships/${encodeURIComponent(slug)}`).catch(() => null);
    const courses = (plan && plan.courses) || [];
    planCoursesById = new Map(courses.map((c) => [c.id, c]));
    return planCoursesById;
  }

  function renderSelectCourses(p) {
    const required = p.courseSelection.required;
    let selected = new Set(p.courseSelection.selectedCourseIds || []);

    dom.selectSub.textContent = `Your pre-booking payment is confirmed. Choose any ${required} course${required === 1 ? '' : 's'} to continue.`;
    dom.selectError.hidden = true;

    function refreshCount() {
      dom.selectCount.textContent = `${selected.size} of ${required} selected`;
      const complete = selected.size === required;
      dom.selectSave.disabled = !complete || isSelectionInFlight;
      dom.selectSave.setAttribute('aria-disabled', String(!complete || isSelectionInFlight));
    }

    showPanel(dom.panelSelect);
    dom.selectGrid.innerHTML = '';
    dom.selectGrid.appendChild(el('p', 'oc-state', 'Loading courses…'));

    loadPlanCourses().then((byId) => {
      dom.selectGrid.innerHTML = '';
      if (!byId.size) {
        const msg = el('p', 'oc-state', 'Could not load the course list. ');
        const link = el('a', null, 'Return to the 1% Club page');
        link.href = 'one-percent-club.html';
        msg.appendChild(link);
        msg.append(' and continue your booking from there.');
        dom.selectGrid.appendChild(msg);
        return;
      }
      for (const [id, c] of byId) {
        const card = el('article', 'oc-course');
        card.dataset.courseId = id;
        card.tabIndex = 0;
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', c.title);

        const thumb = el('div', 'oc-thumb');
        if (c.thumbnail) {
          const img = document.createElement('img');
          img.src = c.thumbnail;
          img.alt = '';
          img.loading = 'lazy';
          thumb.appendChild(img);
        } else {
          thumb.appendChild(el('div', 'oc-thumb-initials', (c.title || '?').charAt(0).toUpperCase()));
        }
        card.appendChild(thumb);

        const body = el('div', 'oc-cbody');
        body.appendChild(el('h3', 'oc-ctitle', c.title));
        const foot = el('div', 'oc-cfoot');
        const btn = el('button', 'oc-pick', selected.has(id) ? 'Selected' : 'Select');
        btn.type = 'button';
        card.classList.toggle('is-on', selected.has(id));
        btn.setAttribute('aria-pressed', String(selected.has(id)));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selected.has(id)) {
            selected.delete(id);
          } else if (selected.size < required) {
            selected.add(id);
          } else {
            return;
          }
          card.classList.toggle('is-on', selected.has(id));
          btn.textContent = selected.has(id) ? 'Selected' : 'Select';
          btn.setAttribute('aria-pressed', String(selected.has(id)));
          refreshCount();
        });
        foot.appendChild(btn);
        body.appendChild(foot);
        card.appendChild(body);
        dom.selectGrid.appendChild(card);
      }
      refreshCount();
    });

    dom.selectSave.onclick = async () => {
      if (isSelectionInFlight || selected.size !== required) return;
      isSelectionInFlight = true;
      dom.selectError.hidden = true;
      dom.selectSave.disabled = true;
      const spinner = dom.selectSave.querySelector('.oc-btn-spinner');
      const label = dom.selectSave.querySelector('.oc-btn-label');
      if (spinner) spinner.hidden = false;
      if (label) label.textContent = 'Saving…';
      try {
        await PreBookingApi.saveCourseSelection(currentOrderId, [...selected]);
        await loadPurchase(currentOrderId, { silent: true });
      } catch (err) {
        if (err instanceof ApiError && Auth.handleSessionError(err)) return;
        dom.selectError.textContent = (err && err.message) || 'Could not save your selection. Please try again.';
        dom.selectError.hidden = false;
      } finally {
        isSelectionInFlight = false;
        if (spinner) spinner.hidden = true;
        if (label) label.textContent = 'Save selection';
        refreshCount();
      }
    };
  }

  // ---- Panel: course selection complete (read-only + edit) -------------------
  function renderCoursesComplete(p) {
    const titles = p.courseSelection.selectedCourseTitles || [];
    dom.completeSub.textContent = `${titles.length} of ${p.courseSelection.required} courses selected.`;
    dom.completeList.replaceChildren(
      ...(titles.length
        ? titles.map((t) => {
            const row = el('div', 'receipt-course-item');
            row.setAttribute('role', 'listitem');
            const body = el('div', 'receipt-item-body');
            body.appendChild(el('h3', 'receipt-item-title', t));
            row.appendChild(body);
            return row;
          })
        : [el('p', 'text-muted', 'No courses selected yet.')])
    );
    // Editing is only offered while the backend's own allowed-stages window
    // is open (PRE_BOOKED / COURSE_SELECTION_COMPLETE / REMAINING_PAYMENT_PENDING);
    // once REMAINING_PAYMENT_PENDING, editing re-enters the select panel,
    // same endpoint, same backend validation — this button never bypasses it.
    dom.completeEdit.hidden = p.purchaseStage === 'FULLY_PAID';
    dom.completeEdit.onclick = () => renderSelectCourses(p);
    showPanel(dom.panelComplete);
  }

  // ---- Panel: pay remaining balance -------------------------------------------
  function renderPayRemaining(p) {
    const currency = p.currency || 'INR';
    dom.prMembershipPrice.textContent = money(p.membershipPrice, currency);
    dom.prCaptured.textContent = money(p.verifiedCapturedTotal, currency);
    dom.prRemaining.textContent = money(p.remainingBalance, currency);
    showPanel(dom.panelPayRemaining);
  }

  // ---- Panel: fully paid --------------------------------------------------------
  function renderFullyPaid(p) {
    dom.fpOrderLink.href = `order-detail.html?id=${encodeURIComponent(currentOrderId)}`;
    showPanel(dom.panelFullyPaid);
  }

  // ---- Master render: dispatch on purchaseStage / nextAction -----------------
  function render(p) {
    currentPurchase = p;
    document.title = `${p.purchaseStage === 'FULLY_PAID' ? 'Membership Active' : 'Pre-Booking'} — The Knight Club`;
    dom.pageTitle.textContent = p.purchaseStage === 'FULLY_PAID' ? 'Your membership' : 'Your booking';

    renderStageStrip(p.purchaseStage);
    renderSummarySidebar(p);
    dom.sidebar.hidden = p.purchaseStage === 'FULLY_PAID';

    switch (p.purchaseStage) {
      case 'PRE_BOOKING_PENDING_PAYMENT':
        renderPayPreBooking(p);
        break;
      case 'PRE_BOOKED':
        renderSelectCourses(p);
        break;
      case 'COURSE_SELECTION_COMPLETE':
        // Show the recap by default; "Change courses" re-opens the picker.
        renderCoursesComplete(p);
        break;
      case 'REMAINING_PAYMENT_PENDING':
        if (!p.courseSelection.complete) {
          // Defensive: should not normally happen (server guards this), but
          // never strand the student on a dead payment panel.
          renderSelectCourses(p);
        } else {
          renderPayRemaining(p);
        }
        break;
      case 'FULLY_PAID':
        renderFullyPaid(p);
        break;
      default:
        showState('error');
        dom.errorMessage.textContent = 'This booking is in an unexpected state. Please contact support.';
    }

    showState('content');
  }

  // ---- Load / boot -------------------------------------------------------------
  async function loadPurchase(orderId, { silent = false } = {}) {
    if (!silent) showState('loading');
    try {
      const purchase = await PreBookingApi.getPurchase(orderId);
      render(purchase);
    } catch (err) {
      if (err instanceof ApiError && Auth.handleSessionError(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        showState('notfound');
        return;
      }
      showState('error');
      dom.errorMessage.textContent = (err && err.message) || 'Please try again in a moment.';
    }
  }

  async function boot() {
    const params = new URLSearchParams(window.location.search);
    let orderId = params.get('orderId');
    const slug = params.get('slug');
    if (slug) window.__pbPlanSlug = slug;

    if (!orderId) {
      if (!slug) {
        showState('notfound');
        return;
      }
      showState('loading');
      try {
        const result = await PreBookingApi.createOrResume(slug);
        orderId = result.order.id;
        const url = new URL(window.location.href);
        url.searchParams.set('orderId', orderId);
        window.history.replaceState({}, '', url.toString());
        currentOrderId = orderId;
        render(result.purchase);
        return;
      } catch (err) {
        if (err instanceof ApiError && Auth.handleSessionError(err)) return;
        showState('error');
        dom.errorMessage.textContent = (err && err.message) || 'Could not start your pre-booking. Please try again.';
        return;
      }
    }

    currentOrderId = orderId;
    await loadPurchase(orderId);
  }

  dom.errorRetry.addEventListener('click', boot);
  dom.paymentBtn.addEventListener('click', initiatePayment);

  await boot();
})();
