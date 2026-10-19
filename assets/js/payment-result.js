/**
 * payment-result.js — Payment Result Page (Phase 31)
 *
 * FLOW
 * ----
 * 1. Auth guard (Auth.requireAuth) — redirects to login if not signed in.
 * 2. Read ?status and ?orderId from the URL.
 * 3. If status=success AND orderId is present:
 *    a. Fetch GET /api/v1/students/orders/:orderId (or checkout endpoint)
 *       to get the authoritative Order status from the server.
 *    b. If Order.status === PAID → show success state.
 *    c. If Order.status === PENDING (webhook not yet processed) → show pending state.
 *    d. If Order.status === FAILED → show failure state.
 * 4. If status=failure → show failure state immediately.
 *
 * CRITICAL ARCHITECTURE RULE:
 *   This page NEVER trusts the URL parameters alone to declare success.
 *   It always fetches the authoritative Order state from the server.
 *   The URL ?status=success only means "the frontend verify callback succeeded";
 *   the actual Order.status from the DB is the ground truth.
 *
 * POLLING:
 *   If the Order is PENDING (webhook not yet processed), this page polls
 *   for up to 30 seconds before showing the "processing" state. This handles
 *   the brief window between the verify callback and the webhook.
 */

'use strict';

/* global Auth, Api, ApiError, StudentShell, StudentUI, CONFIG */

(async () => {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  // payment-result.html hides <body> while 'auth-pending' is set; reveal it now.
  document.documentElement.classList.remove('auth-pending');

  if (typeof StudentShell !== 'undefined') StudentShell.mount({ user, active: 'orders' });

  // ---- DOM refs -----------------------------------------------------------
  const dom = {
    loading:           document.getElementById('result-loading'),
    success:           document.getElementById('result-success'),
    pending:           document.getElementById('result-pending'),
    failure:           document.getElementById('result-failure'),
    error:             document.getElementById('result-error'),
    // Success details
    successOrderNum:   document.getElementById('success-order-number'),
    successAmount:     document.getElementById('success-amount'),
    successCount:      document.getElementById('success-course-count'),
    successNotice:     document.getElementById('success-enrollment-notice'),
    successOrderLink:  document.getElementById('success-view-order-link'),
    // Pending
    pendingOrderNum:   document.getElementById('pending-order-number'),
    // Failure
    failureMsg:        document.getElementById('failure-message'),
    failureRetryBtn:   document.getElementById('failure-retry-btn'),
  };

  // ---- State machine ------------------------------------------------------
  function showState(name) {
    dom.loading.hidden = name !== 'loading';
    dom.success.hidden = name !== 'success';
    dom.pending.hidden = name !== 'pending';
    dom.failure.hidden = name !== 'failure';
    dom.error.hidden   = name !== 'error';
  }

  // ---- Money formatting ---------------------------------------------------
  function money(minorUnits, currency) {
    return StudentUI.money(minorUnits, currency || 'INR');
  }

  // ---- Fetch Order from server (authoritative state) ----------------------
  async function fetchOrder(orderId) {
    // Use the checkout GET endpoint which is already available to the student
    const data = await Api.get(`/checkout/${encodeURIComponent(orderId)}`);
    return data; // { order, items }
  }

  // ---- Poll for Order PAID status (max 30s, 3s intervals) ----------------
  async function pollForPaid(orderId, maxAttempts = 10, intervalMs = 3000) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const { order, items } = await fetchOrder(orderId);
        if (order.status === 'PAID') return { order, items };
        if (order.status === 'FAILED' || order.status === 'CANCELLED') {
          return { order, items, terminal: true };
        }
      } catch {
        // Transient fetch error — keep polling
      }
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    return null; // timed out
  }

  // ---- Render success -----------------------------------------------------
  function renderSuccess(order, items) {
    dom.successOrderNum.textContent = order.orderNumber || '—';
    dom.successAmount.textContent = money(order.total, order.currency);
    dom.successCount.textContent = `${items.length} ${items.length === 1 ? 'course' : 'courses'}`;

    // Link to order detail if available
    if (order.id && dom.successOrderLink) {
      dom.successOrderLink.href = `order-detail.html?id=${encodeURIComponent(order.id)}`;
    }

    // Show enrollment notice — Phase 32 handles enrollment async;
    // payment just marks the order PAID
    if (dom.successNotice) dom.successNotice.hidden = false;

    document.title = 'Payment Successful — The Knight Club';
    showState('success');
  }

  // ---- Render pending -----------------------------------------------------
  function renderPending(order) {
    if (dom.pendingOrderNum && order) {
      dom.pendingOrderNum.textContent = order.orderNumber || '—';
    }
    document.title = 'Payment Processing — The Knight Club';
    showState('pending');
  }

  // ---- URL params ---------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const urlStatus = params.get('status');
  const orderId = params.get('orderId');

  // ---- Failure shortcut ---------------------------------------------------
  if (urlStatus === 'failure' || urlStatus === 'failed') {
    document.title = 'Payment Failed — The Knight Club';
    showState('failure');

    if (dom.failureRetryBtn && orderId) {
      dom.failureRetryBtn.addEventListener('click', () => {
        window.location.href = `checkout.html?orderId=${encodeURIComponent(orderId)}`;
      });
    } else if (dom.failureRetryBtn) {
      dom.failureRetryBtn.addEventListener('click', () => {
        window.location.href = 'cart.html';
      });
    }
    return;
  }

  // ---- No orderId → can't show anything useful ---------------------------
  if (!orderId) {
    document.title = 'Payment Result — The Knight Club';
    showState('error');
    return;
  }

  // ---- Show loading, then fetch authoritative Order state ----------------
  showState('loading');

  try {
    // First attempt: get the current Order state
    let order, items;
    try {
      const result = await fetchOrder(orderId);
      order = result.order;
      items = result.items;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        Auth.handleSessionError(err);
        return;
      }
      showState('error');
      return;
    }

    if (order.status === 'PAID') {
      renderSuccess(order, items);
      return;
    }

    if (order.status === 'FAILED' || order.status === 'CANCELLED') {
      document.title = 'Payment Failed — The Knight Club';
      if (dom.failureMsg) {
        dom.failureMsg.textContent = 'Your payment was not completed. No money has been deducted.';
      }
      if (dom.failureRetryBtn) {
        dom.failureRetryBtn.addEventListener('click', () => {
          window.location.href = `checkout.html?orderId=${encodeURIComponent(orderId)}`;
        });
      }
      showState('failure');
      return;
    }

    // Order is PENDING (webhook not yet processed) — poll briefly
    if (order.status === 'PENDING' && urlStatus === 'success') {
      // Show a brief "Confirming…" loading state while polling
      showState('loading');
      const pollResult = await pollForPaid(orderId);

      if (pollResult && pollResult.order.status === 'PAID') {
        renderSuccess(pollResult.order, pollResult.items);
        return;
      }
      if (pollResult && pollResult.terminal) {
        document.title = 'Payment Failed — The Knight Club';
        showState('failure');
        return;
      }

      // Webhook still pending after polling — show the "processing" state
      renderPending(order);
      return;
    }

    // Any other state (shouldn't happen normally)
    renderPending(order);

  } catch (err) {
    showState('error');
  }
})();