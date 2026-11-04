/**
 * Order Details controller (Phase 33 — Student Order History).
 *
 * PHASE 33 CHANGES FROM PHASE 26:
 *   - Fetches GET /students/orders/:orderId which now returns a full Order
 *     (Phase 28+) with OrderItems, NOT a single Payment document.
 *   - Renders EACH purchased course as a rich item card (Phase 33 spec Part 27).
 *   - Displays per-item fulfilment status: PENDING / FULFILLED / ALREADY_OWNED /
 *     FAILED / CANCELLED (Phase 33 spec Parts 14-18).
 *   - Shows a learning CTA (Start/Continue Learning) ONLY when item.canLearn
 *     is true — i.e., the server confirmed an Enrollment exists (spec Part 15).
 *   - Displays PENDING and FAILED order banners (spec Parts 19-20).
 *   - Uses Order.status (PAID/PENDING/FAILED/CANCELLED/REFUNDED) for the
 *     receipt status badge.
 *   - Shows Order.total / subtotal / discount — historical server-computed
 *     values, never recomputed from current course prices (spec Part 11).
 *   - Multi-course Orders display "N Courses" heading, not "Purchased course".
 *
 * OWNERSHIP / IDOR (spec Parts 3-4, 38):
 *   orderId is read from the URL ONLY to tell the server which order to load.
 *   GET /students/orders/:orderId re-verifies ownership against the
 *   authenticated session on every request. A different student's orderId
 *   returns 404; this page shows the same "could not be found" panel.
 *   The frontend never distinguishes "not found" from "belongs to another
 *   student" — intentional (spec Part 38).
 *
 * PRICE INTEGRITY (spec Part 11, 57):
 *   Every amount displayed is read from the stored Order/OrderItem payload.
 *   OrderItem.unitAmount is the actual price paid per course (post-discount).
 *   OrderItem.courseSnapshot.priceAtPurchase is the pre-discount list price.
 *   Nothing is recomputed from today's Course.pricing.basePrice.
 *
 * NO CLIENT-SIDE STATUS MODIFICATION (spec Part 52):
 *   This page is strictly read-only. No button here can change Order status,
 *   OrderItem status, or trigger fulfilment. The only writable action is
 *   navigating to an existing learning experience (spec Part 15).
 *
 * COURSE UNAVAILABLE SAFETY (spec Parts 12-13, 58):
 *   If courseSnapshot is empty, the item renders "Course unavailable" rather
 *   than crashing the whole page.
 *
 * All values are written with textContent, never innerHTML with data.
 */

/* global Auth, Api, ApiError, Forms, StudentShell, StudentUI */

(async function initOrderDetail() {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  document.documentElement.classList.remove('auth-pending');
  StudentShell.mount({ user, active: 'order-detail' });
  const { el } = StudentUI;

  const els = {
    alert:         document.getElementById('order-alert'),
    loading:       document.getElementById('order-loading'),
    notFound:      document.getElementById('order-notfound'),
    error:         document.getElementById('order-error'),
    errorMsg:      document.getElementById('order-error-message'),
    retry:         document.getElementById('order-retry'),
    content:       document.getElementById('order-content'),
    statusBanner:  document.getElementById('order-status-banner'),
    title:         document.getElementById('order-title'),
    date:          document.getElementById('order-date'),
    status:        document.getElementById('order-status'),
    coursesList:   document.getElementById('order-courses-list'),
    summaryFields: document.getElementById('order-summary-fields'),
    paymentFields: document.getElementById('order-payment-fields'),
    couponSection: document.getElementById('order-coupon-section'),
    couponFields:  document.getElementById('order-coupon-fields'),
  };

  function showState(name) {
    els.loading.hidden  = name !== 'loading';
    els.notFound.hidden = name !== 'notfound';
    els.error.hidden    = name !== 'error';
    els.content.hidden  = name !== 'content';
  }

  // ---- KV row renderer (label → value pairs in definition lists) ----------

  /** rows: [label, value, {cls?, mono?}] */
  function renderRows(container, rows) {
    const frag = document.createDocumentFragment();
    for (const [label, value, opts] of rows) {
      const o = opts || {};
      const row = el('div', `kv-row${o.cls ? ` ${o.cls}` : ''}`);
      row.appendChild(el('dt', null, label));
      const dd = el('dd', o.mono ? 'mono' : null, value);
      row.appendChild(dd);
      frag.appendChild(row);
    }
    container.replaceChildren(frag);
  }

  // ---- Order status badge (Order.status — PAID/PENDING/FAILED/CANCELLED/REFUNDED) --

  const ORDER_STATUS_GLYPHS  = { PAID: '✓', PENDING: '◔', FAILED: '✕', CANCELLED: '✕', REFUNDED: '↩' };
  const ORDER_STATUS_LABELS  = { PAID: 'Paid', PENDING: 'Payment Pending', FAILED: 'Payment Failed', CANCELLED: 'Cancelled', REFUNDED: 'Refunded' };

  // ---- Item fulfilment status label + badge --------------------------------

  const ITEM_STATUS_LABELS = {
    PENDING:      'Processing access',
    FULFILLED:    'Access Ready',
    ALREADY_OWNED:'Already Enrolled',
    FAILED:       'Access setup needs attention',
    CANCELLED:    'Cancelled',
  };

  const ITEM_STATUS_GLYPHS = {
    PENDING:      '◔',
    FULFILLED:    '✓',
    ALREADY_OWNED:'✓',
    FAILED:       '!',
    CANCELLED:    '✕',
  };

  function itemStatusBadge(status) {
    const b = el('span', `item-status-badge item-status-${status}`);
    const g = el('span', null, ITEM_STATUS_GLYPHS[status] || '•');
    g.setAttribute('aria-hidden', 'true');
    b.append(g, document.createTextNode(' ' + (ITEM_STATUS_LABELS[status] || status)));
    return b;
  }

  // ---- Course item card (one per OrderItem) --------------------------------

  function courseItemEl(item) {
    const row = el('div', 'receipt-course-item');

    // Thumbnail
    const thumbWrap = el('div', 'receipt-item-thumb');
    const snap = item.courseSnapshot || {};
    if (snap.thumbnail) {
      const img = document.createElement('img');
      img.src = snap.thumbnail;
      img.alt = snap.title || 'Course thumbnail';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.remove();
        thumbWrap.appendChild(fallbackItemThumb(snap));
      });
      thumbWrap.appendChild(img);
    } else {
      thumbWrap.appendChild(fallbackItemThumb(snap));
    }
    row.appendChild(thumbWrap);

    // Body: title + price paid
    const body = el('div', 'receipt-item-body');
    body.appendChild(el('h3', 'receipt-item-title', snap.title || 'Course unavailable'));

    if (typeof item.unitAmount === 'number') {
      // unitAmount is what was actually paid for this course (post-discount allocation)
      body.appendChild(el('p', 'receipt-item-price',
        `Purchased for ${StudentUI.money(item.unitAmount, item.currency)}`));
    }

    // Fulfilment status badge
    body.appendChild(itemStatusBadge(item.status));

    row.appendChild(body);

    // Side: learning CTA (only when confirmed by server via canLearn)
    const side = el('div', 'receipt-item-side');
    if (item.canLearn && item.courseId) {
      const ctaLabel = item.status === 'ALREADY_OWNED' ? 'Go to Learning' : 'Start Learning';
      const cta = el('a', 'btn btn-primary btn-sm');
      cta.href = `learn.html?courseId=${encodeURIComponent(item.courseId)}`;
      cta.textContent = ctaLabel;
      const arrow = el('span', 'btn-arrow', '→');
      arrow.setAttribute('aria-hidden', 'true');
      cta.appendChild(arrow);
      side.appendChild(cta);
    } else if (item.status === 'ALREADY_OWNED' && item.courseId) {
      // ALREADY_OWNED but server didn't confirm enrollment — show info only
      side.appendChild(el('span', 'item-status-badge item-status-ALREADY_OWNED',
        'Already in My Learning'));
    }
    row.appendChild(side);

    return row;
  }

  function fallbackItemThumb(snap) {
    const f = el('div', 'receipt-item-thumb-fallback',
      (snap.title || '?').charAt(0).toUpperCase());
    f.setAttribute('aria-hidden', 'true');
    return f;
  }

  // ---- Status banner (for non-PAID orders) --------------------------------

  function renderStatusBanner(order) {
    if (order.status === 'PAID') {
      els.statusBanner.hidden = true;
      return;
    }

    let cls = '';
    let text = '';

    if (order.status === 'PENDING') {
      cls = 'is-warning';
      text = 'Payment is pending for this order.';
    } else if (order.status === 'FAILED') {
      cls = 'is-danger';
      text = 'Payment failed for this order. Please place a new order to purchase these courses.';
    } else if (order.status === 'CANCELLED') {
      cls = 'is-warning';
      text = 'This order was cancelled before payment was completed.';
    } else if (order.status === 'REFUNDED') {
      cls = 'is-warning';
      text = 'This order has been refunded.';
    }

    if (!cls) { els.statusBanner.hidden = true; return; }

    els.statusBanner.className = `order-status-banner ${cls}`;
    els.statusBanner.textContent = text;
    els.statusBanner.setAttribute('role', 'status');
    els.statusBanner.hidden = false;
  }

  // ---- Main render function -----------------------------------------------

  function render(order) {
    const { money } = StudentUI;
    const currency = order.currency;

    // ---- Status banner (non-PAID orders) -----------------------------------
    renderStatusBanner(order);

    // ---- Receipt header: order number + date + status badge ----------------
    els.title.textContent = `Order ${order.orderNumber}`;
    if (order.kind === 'MEMBERSHIP') {
      const tag = document.createElement('span');
      tag.className = 'member-badge';
      tag.textContent = '1% Club';
      els.title.appendChild(tag);
    }
    els.date.textContent  = StudentUI.formatDate(order.createdAt);

    const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status;
    const glyph = ORDER_STATUS_GLYPHS[order.status] || '';
    els.status.className = `receipt-status status-${order.status}`;
    els.status.textContent = `${glyph} ${statusLabel}`;

    // ---- Purchased courses (multi-course) -----------------------------------
    const items = order.items || [];
    const courseLabel = items.length === 1 ? '1 Course' : `${items.length} Courses`;
    // Update the eyebrow heading
    const coursesHeading = document.getElementById('order-courses-heading');
    if (coursesHeading) {
      coursesHeading.textContent = `Purchased ${courseLabel}`;
    }

    const coursesFrag = document.createDocumentFragment();
    if (items.length === 0) {
      coursesFrag.appendChild(el('p', 'text-muted', 'No course information available.'));
    } else {
      for (const item of items) {
        coursesFrag.appendChild(courseItemEl(item));
      }
    }
    els.coursesList.replaceChildren(coursesFrag);

    // ---- Order summary (financial — historical server-computed values) -----
    const summaryRows = [];

    if (items.length > 1) {
      // Multi-course: show subtotal, then discount, then total
      summaryRows.push(['Subtotal', money(order.subtotal, currency)]);
      if (order.discount && order.discount > 0) {
        summaryRows.push(['Discount', `−${money(order.discount, currency)}`, { cls: 'is-discount' }]);
        if (order.couponCode) {
          summaryRows.push(['Coupon', order.couponCode]);
        }
      }
      summaryRows.push(['Total', money(order.total, currency), { cls: 'is-total' }]);
    } else if (items.length === 1) {
      // Single course: just show the course price and total
      const snap = items[0].courseSnapshot || {};
      if (typeof snap.priceAtPurchase === 'number') {
        summaryRows.push(['Course price', money(snap.priceAtPurchase, currency)]);
      }
      if (order.discount && order.discount > 0) {
        summaryRows.push(['Discount', `−${money(order.discount, currency)}`, { cls: 'is-discount' }]);
      }
      summaryRows.push(['Total', money(order.total, currency), { cls: 'is-total' }]);
    } else {
      summaryRows.push(['Total', money(order.total, currency), { cls: 'is-total' }]);
    }

    renderRows(els.summaryFields, summaryRows);

    // ---- Payment information -----------------------------------------------
    const pmt = order.payment;
    const paymentRows = [];

    if (pmt) {
      const pmtStatusLabels = {
        CAPTURED:   'Successful',
        AUTHORIZED: 'Authorised',
        CREATED:    'Pending',
        FAILED:     'Failed',
        CANCELLED:  'Cancelled',
        EXPIRED:    'Expired',
      };
      paymentRows.push(['Payment status', pmtStatusLabels[pmt.status] || pmt.status]);

      if (pmt.failureReason) {
        paymentRows.push(['Failure reason', pmt.failureReason]);
      }

      if (pmt.razorpayPaymentId) {
        paymentRows.push(['Payment ID', pmt.razorpayPaymentId, { mono: true }]);
      }

      if (pmt.capturedAt) {
        paymentRows.push(['Payment date', StudentUI.formatDateTime(pmt.capturedAt)]);
      } else if (pmt.authorizedAt) {
        paymentRows.push(['Authorised at', StudentUI.formatDateTime(pmt.authorizedAt)]);
      }
    } else {
      paymentRows.push(['Payment status', 'No payment record']);
    }

    renderRows(els.paymentFields, paymentRows);

    // ---- Coupon/discount section -------------------------------------------
    if (order.couponCode) {
      renderRows(els.couponFields, [
        ['Coupon code',       order.couponCode],
        ['Discount applied',  money(order.couponDiscountAmount || order.discount || 0, currency)],
      ]);
      els.couponSection.hidden = false;
    } else {
      els.couponSection.hidden = true;
    }

    // ---- Show content + update page title ----------------------------------
    showState('content');
    document.title = `Order ${order.orderNumber} — The Knight Club`;
  }

  // ---- Load order ---------------------------------------------------------

  async function loadOrder() {
    const params  = new URLSearchParams(window.location.search);
    const orderId = params.get('id');

    if (!orderId) {
      showState('notfound');
      return;
    }

    showState('loading');
    try {
      const result = await Api.get(`/students/orders/${encodeURIComponent(orderId)}`);
      render(result.order);
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        showState('notfound');
        return;
      }
      showState('error');
      els.errorMsg.textContent = err.message || 'Please try again in a moment.';
    }
  }

  els.retry.addEventListener('click', loadOrder);
  await loadOrder();
})();
