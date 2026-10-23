/**
 * "My Orders" list controller (Phase 33 — Student Order History).
 *
 * PHASE 33 CHANGES FROM PHASE 26:
 *   - Renders multi-course Order cards (not single-course Payment rows).
 *   - Uses Order.status, Order.orderNumber, Order.total, Order.itemCount.
 *   - Shows thumbnail strip for purchased courses.
 *   - Adds filter pills (All / Paid / Pending / Failed).
 *   - Status badges use Order.status values (PAID / PENDING / FAILED /
 *     CANCELLED / REFUNDED) rather than Payment.status values.
 *   - Link goes to order-detail.html?id=<Order._id>
 *
 * OWNERSHIP: GET /students/orders never takes a student id from this page —
 * the backend derives "whose orders" entirely from the authenticated session.
 *
 * LOADING / EMPTY / ERROR: loading skeletons first; a genuinely empty list
 * shows a premium empty state; a failed request shows a retry panel.
 *
 * PAGINATION: server-side, newest-first. This page only tracks currentPage
 * and asks the server; it never sorts a locally-cached full list.
 *
 * PRICE INTEGRITY: every amount displayed is from the stored Order.total —
 * never recomputed from current course prices.
 *
 * NO CACHE DEPENDENCY: Orders do not depend on the current Cart state.
 */

/* global Auth, Api, ApiError, Forms, StudentShell, StudentUI, CONFIG */

(async function initOrders() {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  document.documentElement.classList.remove('auth-pending');
  StudentShell.mount({ user, active: 'orders' });
  const { el } = StudentUI;

  const els = {
    alert:       document.getElementById('orders-alert'),
    filters:     document.getElementById('orders-filters'),
    loading:     document.getElementById('orders-loading'),
    empty:       document.getElementById('orders-empty'),
    error:       document.getElementById('orders-error'),
    errorMsg:    document.getElementById('orders-error-message'),
    retry:       document.getElementById('orders-retry'),
    list:        document.getElementById('orders-list'),
    pagination:  document.getElementById('orders-pagination'),
    prev:        document.getElementById('orders-prev'),
    next:        document.getElementById('orders-next'),
    pageInfo:    document.getElementById('orders-page-info'),
  };

  let currentPage = 1;
  let currentStatus = null; // null = All
  const PAGE_SIZE = 10;

  // ---- Filter pills -------------------------------------------------------

  const FILTER_OPTIONS = [
    { label: 'All',       value: null },
    { label: 'Paid',      value: 'PAID' },
    { label: 'Pending',   value: 'PENDING' },
    { label: 'Failed',    value: 'FAILED' },
    { label: 'Cancelled', value: 'CANCELLED' },
  ];

  function buildFilters() {
    const frag = document.createDocumentFragment();
    for (const opt of FILTER_OPTIONS) {
      const btn = el('button', 'filter-pill');
      btn.type = 'button';
      btn.textContent = opt.label;
      if (opt.value === currentStatus) btn.classList.add('is-active');
      btn.addEventListener('click', () => {
        if (currentStatus === opt.value) return;
        currentStatus = opt.value;
        currentPage = 1;
        // Update active pill
        for (const p of els.filters.querySelectorAll('.filter-pill')) {
          p.classList.remove('is-active');
        }
        btn.classList.add('is-active');
        loadOrders(1);
      });
      frag.appendChild(btn);
    }
    els.filters.replaceChildren(frag);
    els.filters.hidden = false;
  }

  // ---- State management ---------------------------------------------------

  function showState(name) {
    els.loading.hidden   = name !== 'loading';
    els.empty.hidden     = name !== 'empty';
    els.error.hidden     = name !== 'error';
    els.list.hidden      = name !== 'list';
    els.pagination.hidden = name !== 'list';
  }

  // ---- Thumbnail strip renderer ------------------------------------------

  /**
   * Renders a row of up to 3 course thumbnails + overflow count.
   * @param {Array<{title, thumbnail, slug}>} snapshots
   */
  function thumbStrip(snapshots) {
    const strip = el('div', 'order-card-thumbs');
    const MAX_SHOWN = 3;
    const shown = snapshots.slice(0, MAX_SHOWN);

    for (const snap of shown) {
      const wrap = el('div', 'order-card-thumb');
      if (snap.thumbnail) {
        const img = document.createElement('img');
        img.src = snap.thumbnail;
        img.alt = snap.title || 'Course';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
          img.remove();
          wrap.appendChild(fallbackThumbInner(snap));
        });
        wrap.appendChild(img);
      } else {
        wrap.appendChild(fallbackThumbInner(snap));
      }
      strip.appendChild(wrap);
    }

    if (snapshots.length > MAX_SHOWN) {
      strip.appendChild(el('span', 'order-card-thumb-more',
        `+${snapshots.length - MAX_SHOWN} more`));
    }

    return strip;
  }

  function fallbackThumbInner(snap) {
    const f = el('div', 'order-card-thumb-fallback',
      (snap.title || '?').charAt(0).toUpperCase());
    f.setAttribute('aria-hidden', 'true');
    return f;
  }

  // ---- Order status badge (uses Order.status values) ----------------------

  const ORDER_STATUS_GLYPHS = {
    PAID:      '✓',
    PENDING:   '◔',
    FAILED:    '✕',
    CANCELLED: '✕',
    REFUNDED:  '↩',
  };

  const ORDER_STATUS_LABELS = {
    PAID:      'Paid',
    PENDING:   'Payment Pending',
    FAILED:    'Payment Failed',
    CANCELLED: 'Cancelled',
    REFUNDED:  'Refunded',
  };

  function orderStatusBadge(status) {
    const b = el('span', `status-badge status-${status}`);
    const glyph = el('span', 'status-glyph', ORDER_STATUS_GLYPHS[status] || '•');
    glyph.setAttribute('aria-hidden', 'true');
    b.append(glyph, document.createTextNode(ORDER_STATUS_LABELS[status] || status));
    return b;
  }

  // ---- Order card renderer ------------------------------------------------

  function orderCardEl(order) {
    const card = el('article', 'order-card');
    card.setAttribute('aria-label', `Order ${order.orderNumber}`);

    // Top row: order number + date + status badge
    const top = el('div', 'order-card-top');
    const meta = el('div');
    const numberRow = el('div', 'order-card-number', `Order ${order.orderNumber}`);
    if (order.kind === 'MEMBERSHIP') numberRow.appendChild(el('span', 'member-badge', '1% Club'));
    meta.appendChild(numberRow);
    meta.appendChild(el('div', 'order-card-date',
      StudentUI.formatDateShort(order.createdAt)));
    top.appendChild(meta);
    top.appendChild(orderStatusBadge(order.status));
    card.appendChild(top);

    // Main body: thumbnail strip + course names summary
    const body = el('div', 'order-card-body');
    const snapshots = order.courseSnapshots || [];
    if (snapshots.length > 0) {
      body.appendChild(thumbStrip(snapshots));
      // List up to 2 course titles below the strip
      const names = snapshots.slice(0, 2).map((s) => s.title || 'Untitled').join(', ');
      const extra = snapshots.length > 2 ? ` +${snapshots.length - 2} more` : '';
      body.appendChild(el('p', 'order-card-course-names', names + extra));
    } else {
      body.appendChild(el('p', 'order-card-course-names', 'No course information'));
    }
    card.appendChild(body);

    // Side: amount + count + view button
    const side = el('div', 'order-card-side');

    const amtWrap = el('div');
    amtWrap.appendChild(el('div', 'order-card-amount',
      StudentUI.money(order.total, order.currency)));
    amtWrap.appendChild(el('div', 'order-card-count',
      order.itemCount === 1 ? '1 course' : `${order.itemCount} courses`));
    side.appendChild(amtWrap);

    const link = el('a', 'btn btn-outline btn-sm');
    link.href = `order-detail.html?id=${encodeURIComponent(order.id)}`;
    link.setAttribute('aria-label', `View order ${order.orderNumber}`);
    link.append('View Order');
    const arrow = el('span', 'btn-arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    link.appendChild(arrow);
    side.appendChild(link);

    card.appendChild(side);
    return card;
  }

  // ---- Load orders --------------------------------------------------------

  async function loadOrders(page) {
    Forms.hideAlert(els.alert);
    showState('loading');

    let url = `/students/orders?page=${page}&limit=${PAGE_SIZE}`;
    if (currentStatus) url += `&status=${encodeURIComponent(currentStatus)}`;

    try {
      const result = await Api.get(url);
      currentPage = result.pagination.page;

      if (result.items.length === 0 && currentPage === 1 && !currentStatus) {
        showState('empty');
        return;
      }

      if (result.items.length === 0) {
        // Filtered empty — show a minimal message rather than the "never bought" state
        els.list.replaceChildren(el('p', 'text-muted',
          'No orders match this filter.'));
        showState('list');
        els.pagination.hidden = true;
        return;
      }

      const frag = document.createDocumentFragment();
      for (const order of result.items) frag.appendChild(orderCardEl(order));
      els.list.replaceChildren(frag);
      showState('list');

      const total = result.pagination.totalPages || 1;
      els.prev.disabled = currentPage <= 1;
      els.next.disabled = currentPage >= total;
      els.pageInfo.textContent = `Page ${currentPage} of ${total}`;
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      showState('error');
      els.errorMsg.textContent = err.message || 'Please try again in a moment.';
    }
  }

  // ---- Events -------------------------------------------------------------

  els.retry.addEventListener('click', () => loadOrders(currentPage));
  els.prev.addEventListener('click', () => loadOrders(Math.max(1, currentPage - 1)));
  els.next.addEventListener('click', () => loadOrders(currentPage + 1));

  // ---- Init ---------------------------------------------------------------

  buildFilters();
  await loadOrders(1);
})();
