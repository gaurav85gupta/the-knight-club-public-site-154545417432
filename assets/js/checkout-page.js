/**
 * checkout-page.js — Checkout Review Page (Phase 30 + Phase 31 + Phase 34)
 *
 * FLOW
 * ----
 * 1. Auth guard (Auth.requireAuth) — redirects to login if not signed in.
 * 2. On first load (no ?orderId in URL):
 *    a. POST /api/v1/checkout   (empty body — server reads the cart)
 *    b. Server creates/returns a PENDING Order with OrderItems.
 *    c. Replace URL with ?orderId=<id> so the Back button + refresh work.
 *    d. Render the checkout review.
 * 3. On reload / back-navigation (orderId already in URL):
 *    a. GET /api/v1/checkout/:orderId
 *    b. Render the checkout review (same path as above).
 *
 * COUPON FLOW (Phase 34)
 * ----------------------
 * The coupon section lives inside the Order Summary panel (NOT on Course Detail
 * or Cart). It becomes interactive once an Order has been created/loaded.
 *
 * Apply:  POST /api/v1/checkout/:orderId/coupon  { code }
 *   - Body contains ONLY the raw coupon code. No price, discount, or amount.
 *   - Server validates fully (auth, existence, dates, limits, courses) and
 *     persists the server-calculated discount to the Order.
 *   - Returns the updated safe Order; UI re-renders summary with new totals.
 *
 * Remove: DELETE /api/v1/checkout/:orderId/coupon
 *   - Server clears coupon fields, restores subtotal as total.
 *   - Returns the updated safe Order; UI re-renders with original totals.
 *
 * PAYMENT FLOW (Phase 31)
 * -----------------------
 * "Continue to Payment" button:
 *   1. POST /api/v1/payments/order-payments  { orderId }
 *      → Server re-reads the Order's total (which already has the coupon
 *        discount baked in server-side) and returns Razorpay checkout params.
 *   2. Open Razorpay Checkout with those params.
 *   3. On Razorpay success callback:
 *      POST /api/v1/payments/order-payments/verify
 *      { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 *   4. On verified response: redirect to payment-result.html?status=success&orderId=<id>
 *   5. On Razorpay dismiss: POST /api/v1/payments/order-payments/cancel (best-effort)
 *   6. On any failure: show inline error, re-enable button.
 *
 * CRITICAL ARCHITECTURE RULE:
 *   The frontend NEVER trusts Razorpay's own callback as payment success.
 *   Only the backend's /verify response is trusted.
 *   The Order is PAID only after the webhook runs server-side; the frontend
 *   shows the payment-result page regardless and lets the server confirm status.
 *
 * SECURITY:
 *   - The frontend NEVER calculates or stores a discount amount.
 *   - All totals rendered on screen come exclusively from the server Order.
 *   - No price/amount is sent to the server from this page.
 *   - orderId in the URL is only used to RETRIEVE — not to prove ownership.
 *   - Student identity comes from the authenticated session cookie.
 */

'use strict';

/* global Auth, Api, ApiError, StudentShell, StudentUI, CONFIG, Payments */

(async () => {
  // ---- Auth guard ---------------------------------------------------------
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  // checkout.html hides <body> while 'auth-pending' is set; reveal it now.
  document.documentElement.classList.remove('auth-pending');

  // ---- StudentShell injects the nav header + footer -----------------------
  if (typeof StudentShell !== 'undefined') StudentShell.mount({ user, active: 'cart' });

  // ---- DOM refs -----------------------------------------------------------
  const { el } = StudentUI;

  const dom = {
    loading:            document.getElementById('checkout-loading'),
    content:            document.getElementById('checkout-content'),
    error:              document.getElementById('checkout-error'),
    // Content region
    orderNumber:        document.getElementById('checkout-order-number'),
    idempotentNotice:   document.getElementById('checkout-idempotent-notice'),
    itemsList:          document.getElementById('checkout-items-list'),
    itemsCount:         document.getElementById('checkout-items-count'),
    // Summary
    summarySubtotal:    document.getElementById('summary-subtotal'),
    summaryDiscountRow: document.getElementById('summary-discount-row'),
    summaryDiscount:    document.getElementById('summary-discount'),
    summaryTotal:       document.getElementById('summary-total'),
    // Policy agreement
    agreeCheckbox:      document.getElementById('checkout-agree-terms'),
    // Payment CTA
    paymentBtn:         document.getElementById('checkout-payment-btn'),
    paymentBtnText:     document.getElementById('checkout-payment-btn-text'),
    paymentNotice:      document.getElementById('checkout-payment-notice'),
    paymentNoticeText:  document.getElementById('checkout-payment-notice-text'),
    paymentError:       document.getElementById('checkout-payment-error'),
    paymentErrorText:   document.getElementById('checkout-payment-error-text'),
    // Error state
    errorTitle:         document.getElementById('checkout-error-title'),
    errorMessage:       document.getElementById('checkout-error-message'),
    errorItems:         document.getElementById('checkout-error-items'),
    retryBtn:           document.getElementById('checkout-retry-btn'),
    goCartBtn:          document.getElementById('checkout-go-cart-btn'),
    // Coupon (Phase 34)
    couponSection:      document.getElementById('coupon-section'),
    couponApplyRow:     document.getElementById('coupon-apply-row'),
    couponAppliedRow:   document.getElementById('coupon-applied-row'),
    couponInput:        document.getElementById('coupon-code-input'),
    couponApplyBtn:     document.getElementById('coupon-apply-btn'),
    couponApplySpinner: document.querySelector('#coupon-apply-btn .coupon-btn-spinner'),
    couponApplyLabel:   document.querySelector('#coupon-apply-btn .coupon-btn-label'),
    couponAppliedCode:  document.getElementById('coupon-applied-code'),
    couponAppliedDisc:  document.getElementById('coupon-applied-discount'),
    couponRemoveBtn:    document.getElementById('coupon-remove-btn'),
    couponMessage:      document.getElementById('coupon-message'),
    summaryDiscountDt:  document.querySelector('#summary-discount-row dt'),
  };

  // ---- Current order state (updated after checkout POST/GET) --------------
  let currentOrder = null;
  let isPaymentInFlight = false;
  let isCouponInFlight = false;

  // ---- State machine ------------------------------------------------------
  function showState(name) {
    dom.loading.hidden = name !== 'loading';
    dom.content.hidden = name !== 'content';
    dom.error.hidden   = name !== 'error';
  }

  // ---- Payment UI helpers -------------------------------------------------
  function setPaymentProcessing(label) {
    isPaymentInFlight = true;
    dom.paymentBtn.disabled = true;
    dom.paymentBtn.setAttribute('aria-disabled', 'true');
    dom.paymentBtnText.textContent = label || 'Processing…';
    dom.paymentNoticeText.textContent = label || 'Processing…';
    dom.paymentNotice.hidden = false;
    dom.paymentError.hidden = true;
  }

  /**
   * The payment button may only be enabled when: no payment/cancel request
   * is in flight, AND the student has ticked the policy-agreement checkbox.
   * Every place that would otherwise "enable" the button goes through this
   * instead, so the agreement gate can never be bypassed by a later
   * dom.paymentBtn.disabled = false.
   */
  function syncPaymentBtnState() {
    const agreed = !!(dom.agreeCheckbox && dom.agreeCheckbox.checked);
    const shouldEnable = agreed && !isPaymentInFlight;
    dom.paymentBtn.disabled = !shouldEnable;
    if (shouldEnable) {
      dom.paymentBtn.removeAttribute('aria-disabled');
    } else {
      dom.paymentBtn.setAttribute('aria-disabled', 'true');
    }
  }

  function resetPaymentBtn() {
    isPaymentInFlight = false;
    dom.paymentBtnText.textContent = 'Continue to Payment';
    dom.paymentNotice.hidden = true;
    syncPaymentBtnState();
  }

  /**
   * Called when the backend signals a dismiss-block after too many dismissals.
   * Keeps the payment button disabled and shows a live countdown in the error
   * area. Re-enables the button automatically when the block expires.
   *
   * @param {number} remainingMs - Milliseconds until the block lifts.
   */
  function startDismissBlockCountdown(remainingMs) {
    // Keep button locked while block is active.
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
        hidePaymentError();
        resetPaymentBtn();
        return;
      }
      dom.paymentErrorText.textContent =
        `Too many attempts. Please wait ${formatTime(left)} before trying again.`;
      dom.paymentError.hidden = false;
      dom.paymentBtnText.textContent = `Wait ${formatTime(left)}`;
      setTimeout(tick, 1000);
    }

    tick();
  }

  function showPaymentError(message) {
    resetPaymentBtn();
    dom.paymentErrorText.textContent = message || 'Payment could not be completed. Please try again.';
    dom.paymentError.hidden = false;
  }

  function hidePaymentError() {
    dom.paymentError.hidden = true;
  }

  // ---- Money formatting ---------------------------------------------------
  function money(minorUnits, currency) {
    return StudentUI.money(minorUnits, currency || 'INR');
  }

  // ---- Render one order item card -----------------------------------------
  /**
   * Renders a single OrderItem card.
   *
   * For COURSE orders the per-item price (unitAmount) is shown as usual.
   * For MEMBERSHIP orders every item's unitAmount is 0 (the economic value
   * is the plan total stored in Order.total, not per-course).  Showing ₹0
   * per course is misleading, so MEMBERSHIP items show an "Included" badge
   * instead of a price.
   *
   * @param {object}  item         — safe OrderItem from the server
   * @param {boolean} isMembership — true when order.kind === 'MEMBERSHIP'
   */
  function renderItem(item, isMembership) {
    const snap = item.courseSnapshot || {};
    const title = snap.title || 'Course';

    const card = el('div', 'checkout-item');
    card.setAttribute('role', 'listitem');

    const thumbWrap = el('div', 'checkout-item-thumb');
    if (snap.thumbnail) {
      const img = document.createElement('img');
      img.src = snap.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.remove();
        const f = el('div', 'thumb-fallback', title.charAt(0).toUpperCase());
        f.setAttribute('aria-hidden', 'true');
        thumbWrap.appendChild(f);
      });
      thumbWrap.appendChild(img);
    } else {
      const f = el('div', 'thumb-fallback', title.charAt(0).toUpperCase());
      f.setAttribute('aria-hidden', 'true');
      thumbWrap.appendChild(f);
    }

    const body = el('div', 'checkout-item-body');
    body.appendChild(el('h3', 'checkout-item-title', title));

    if (isMembership) {
      // Membership items are bundled at the plan price — per-item price is
      // meaningless (server stores unitAmount = 0).  Show "Included" instead.
      const badge = el('span', 'checkout-item-membership-badge', 'Included in membership');
      body.appendChild(badge);
    } else {
      body.appendChild(el('p', 'checkout-item-price', money(item.unitAmount, item.currency)));
    }

    card.appendChild(thumbWrap);
    card.appendChild(body);
    return card;
  }

  // ---- Render full checkout review ----------------------------------------
  // ---- Summary render helpers (also used by coupon update) ----------------

  /**
   * Re-renders the price summary rows from an authoritative Order object.
   * Called by renderCheckout (initial load) and after coupon apply/remove.
   * NEVER called with frontend-calculated values — always pass the Order
   * object returned directly from the server.
   */
  function renderSummary(order) {
    const currency = order.currency || 'INR';
    dom.summarySubtotal.textContent = money(order.subtotal, currency);
    dom.summaryTotal.textContent    = money(order.total, currency);

    if (order.discount && order.discount > 0) {
      // Show coupon code as a sub-label inside the "Discount" dt if present
      if (dom.summaryDiscountDt) {
        let codeLabel = dom.summaryDiscountDt.querySelector('.coupon-code-label');
        if (order.couponCode) {
          if (!codeLabel) {
            codeLabel = document.createElement('span');
            codeLabel.className = 'coupon-code-label';
            dom.summaryDiscountDt.appendChild(codeLabel);
          }
          codeLabel.textContent = order.couponCode;
        } else if (codeLabel) {
          codeLabel.remove();
        }
      }
      dom.summaryDiscount.textContent = `−${money(order.discount, currency)}`;
      dom.summaryDiscountRow.hidden = false;
    } else {
      if (dom.summaryDiscountDt) {
        const codeLabel = dom.summaryDiscountDt.querySelector('.coupon-code-label');
        if (codeLabel) codeLabel.remove();
      }
      dom.summaryDiscountRow.hidden = true;
    }
  }

  // ---- Coupon UI helpers --------------------------------------------------

  /** Shows the "coupon applied" badge and hides the input row. */
  function showCouponApplied(code, discountAmount, currency) {
    dom.couponApplyRow.hidden = true;
    dom.couponAppliedRow.hidden = false;
    dom.couponAppliedCode.textContent = code;
    if (discountAmount && discountAmount > 0) {
      dom.couponAppliedDisc.textContent = `−${money(discountAmount, currency || 'INR')}`;
      dom.couponAppliedDisc.hidden = false;
    } else {
      dom.couponAppliedDisc.hidden = true;
    }
    hideCouponMessage();
  }

  /** Resets the coupon section to the initial "enter a code" state. */
  function resetCouponUI() {
    dom.couponApplyRow.hidden = false;
    dom.couponAppliedRow.hidden = true;
    dom.couponInput.value = '';
    dom.couponInput.disabled = false;
    hideCouponMessage();
    setCouponLoading(false);
  }

  function showCouponMessage(text, kind) {
    dom.couponMessage.textContent = text;
    dom.couponMessage.className = `coupon-message${kind ? ` is-${kind}` : ''}`;
    dom.couponMessage.hidden = !text;
  }

  function hideCouponMessage() {
    dom.couponMessage.hidden = true;
  }

  function setCouponLoading(on) {
    isCouponInFlight = on;
    dom.couponApplyBtn.disabled = on;
    dom.couponRemoveBtn.disabled = on;
    if (dom.couponApplySpinner) dom.couponApplySpinner.hidden = !on;
    if (dom.couponApplyLabel) dom.couponApplyLabel.textContent = on ? 'Applying…' : 'Apply';
    dom.couponInput.disabled = on;
  }

  // ---- Coupon API calls ---------------------------------------------------

  /**
   * POST /checkout/:orderId/coupon  { code }
   *
   * Sends ONLY the raw coupon code. The server recalculates everything.
   * On success, updates currentOrder and re-renders the summary.
   */
  async function applyCoupon() {
    if (isCouponInFlight || !currentOrder) return;

    const code = dom.couponInput.value.trim();
    if (!code) {
      showCouponMessage('Please enter a coupon code.', 'error');
      dom.couponInput.focus();
      return;
    }

    hideCouponMessage();
    setCouponLoading(true);

    try {
      const data = await Api.post(`/checkout/${encodeURIComponent(currentOrder.id)}/coupon`, { code });
      const updatedOrder = data.order;
      currentOrder = updatedOrder;
      renderSummary(updatedOrder);
      showCouponApplied(updatedOrder.couponCode, updatedOrder.couponDiscountAmount, updatedOrder.currency);
      showCouponMessage(`Coupon applied successfully.`, 'success');
    } catch (err) {
      let message = 'Could not apply this coupon. Please try again.';
      if (err instanceof ApiError) {
        if (Auth.handleSessionError(err)) return;
        message = err.message || message;
      }
      showCouponMessage(message, 'error');
      dom.couponInput.focus();
    } finally {
      setCouponLoading(false);
    }
  }

  /**
   * DELETE /checkout/:orderId/coupon
   *
   * Removes the applied coupon. Server restores subtotal as total.
   * On success, updates currentOrder and re-renders the summary.
   */
  async function removeCoupon() {
    if (isCouponInFlight || !currentOrder) return;

    hideCouponMessage();
    setCouponLoading(true);

    try {
      // Api.delete is the standard DELETE wrapper (same pattern as Api.post)
      const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE_URL) || '/api/v1';
      const res = await fetch(`${apiBase}/checkout/${encodeURIComponent(currentOrder.id)}/coupon`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        cache: 'no-store',
      });

      const payload = await res.json().catch(() => null);

      if (!res.ok || !payload || payload.success === false) {
        throw Object.assign(new Error((payload && payload.message) || 'Could not remove coupon.'), {
          status: res.status,
        });
      }

      const updatedOrder = payload.data.order;
      currentOrder = updatedOrder;
      renderSummary(updatedOrder);
      resetCouponUI();
    } catch (err) {
      let message = 'Could not remove the coupon. Please try again.';
      if (err instanceof ApiError) {
        if (Auth.handleSessionError(err)) return;
        message = err.message || message;
      } else if (err && err.message) {
        message = err.message;
      }
      showCouponMessage(message, 'error');
    } finally {
      setCouponLoading(false);
    }
  }

  function renderCheckout(order, items, idempotent) {
    currentOrder = order;

    dom.orderNumber.textContent = order.orderNumber;
    dom.idempotentNotice.hidden = !idempotent;

    dom.itemsList.innerHTML = '';
    dom.itemsList.setAttribute('role', 'list');
    const count = items.length;
    dom.itemsCount.textContent = `${count} ${count === 1 ? 'course' : 'courses'}`;

    // Membership orders set unitAmount=0 per item; pass flag so renderItem
    // shows "Included in membership" instead of the misleading ₹0 price.
    const isMembership = order.kind === 'MEMBERSHIP';
    items.forEach((item) => dom.itemsList.appendChild(renderItem(item, isMembership)));

    renderSummary(order);

    // Sync coupon UI to the Order's current coupon state (handles reload /
    // back-navigation where a coupon was already applied in a prior session).
    if (order.couponCode) {
      showCouponApplied(order.couponCode, order.couponDiscountAmount, order.currency);
    } else {
      resetCouponUI();
    }

    // Enable the payment button (Phase 31) — gated on policy agreement
    syncPaymentBtnState();
    hidePaymentError();

    document.title = `Checkout — ${order.orderNumber} — The Knight Club`;
    showState('content');
  }

  // ---- Render structured domain errors ------------------------------------
  function renderError(errorCode, message, invalidItems) {
    const titles = {
      CART_EMPTY:           'Your cart is empty',
      INVALID_CART:         'Some items need attention',
      COURSE_NOT_FOUND:     'Course no longer available',
      COURSE_UNAVAILABLE:   'Course no longer available',
      COURSE_ALREADY_OWNED: 'You already own this course',
      PRICE_UNAVAILABLE:    'Pricing unavailable',
      ORDER_NOT_FOUND:      'Order not found',
      SELECTION_NOT_IN_CART: 'Your selection changed',
    };

    dom.errorTitle.textContent   = titles[errorCode] || 'Checkout unavailable';
    dom.errorMessage.textContent = message || 'Please return to your cart and try again.';

    dom.errorItems.innerHTML = '';
    if (Array.isArray(invalidItems) && invalidItems.length > 0) {
      const listEl = el('div', 'checkout-invalid-items');
      invalidItems.forEach(({ title, reason }) => {
        const row = el('div', 'checkout-invalid-item');
        row.insertAdjacentHTML('beforeend',
          `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
        );
        const textWrap = el('div', null);
        if (title)  textWrap.appendChild(el('p', 'checkout-invalid-item-title', title));
        if (reason) textWrap.appendChild(el('p', 'checkout-invalid-item-reason', reason));
        row.appendChild(textWrap);
        listEl.appendChild(row);
      });
      dom.errorItems.appendChild(listEl);
    }

    dom.retryBtn.hidden = (errorCode === 'CART_EMPTY' || errorCode === 'ORDER_NOT_FOUND');
    showState('error');
  }

  // ---- Selective checkout (Cart page "select courses" flow) ---------------
  // The Cart page stores the checked courseIds in sessionStorage right
  // before navigating here. Read it ONCE, then clear it immediately so a
  // page refresh or a later full-cart checkout never silently reuses a
  // stale selection. Absent/invalid storage simply means "whole cart",
  // exactly as this page behaved before selective checkout existed.
  const CHECKOUT_SELECTION_KEY = 'tkc_checkout_selection';

  function readAndClearCheckoutSelection() {
    let selection = null;
    try {
      const raw = sessionStorage.getItem(CHECKOUT_SELECTION_KEY);
      sessionStorage.removeItem(CHECKOUT_SELECTION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) selection = parsed;
      }
    } catch {
      selection = null;
    }
    return selection;
  }

  // ---- Raw POST /checkout -------------------------------------------------
  async function doCheckoutPost(courseIds) {
    const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE_URL) || '/api/v1';
    const body = (Array.isArray(courseIds) && courseIds.length > 0) ? { courseIds } : {};
    const res = await fetch(`${apiBase}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
      credentials: 'include',
      cache: 'no-store',
    });

    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload || payload.success === false) {
      const err = new Error((payload && payload.message) || `Checkout failed (${res.status}).`);
      err.status = res.status;
      err.errorCode = (payload && payload.errorCode) || 'CHECKOUT_ERROR';
      err.invalidItems = (payload && Array.isArray(payload.invalidItems) ? payload.invalidItems : []);
      throw err;
    }

    return payload.data;
  }

  // ---- Checkout flow ------------------------------------------------------
  async function createCheckout() {
    showState('loading');
    try {
      const selection = readAndClearCheckoutSelection();
      const { order, items, idempotent } = await doCheckoutPost(selection);

      const url = new URL(window.location.href);
      url.searchParams.set('orderId', order.id);
      window.history.replaceState({ orderId: order.id }, '', url.toString());

      renderCheckout(order, items, idempotent);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        Auth.handleSessionError(err instanceof ApiError ? err : Object.assign(new ApiError(err.message, { status: err.status }), err));
        return;
      }
      renderError(err.errorCode || 'CHECKOUT_ERROR', err.message, err.invalidItems);
    }
  }

  // ---- Load existing order ------------------------------------------------
  async function loadExistingOrder(orderId) {
    showState('loading');
    try {
      const data = await Api.get(`/checkout/${encodeURIComponent(orderId)}`);
      const { order, items } = data;
      renderCheckout(order, items, false);
    } catch (err) {
      if (err instanceof ApiError) {
        if (Auth.handleSessionError(err)) return;
        if (err.status === 404) {
          renderError('ORDER_NOT_FOUND', 'This order could not be found. It may have expired.');
          return;
        }
        renderError(err.errorCode || 'CHECKOUT_ERROR', err.message);
        return;
      }
      renderError('CHECKOUT_ERROR', err.message || 'Unable to load this order. Please try again.');
    }
  }

  // ---- Payment flow (Phase 31) --------------------------------------------

  /**
   * Loads the Razorpay Checkout script lazily.
   */
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
   * Initiates the full Order-based payment flow:
   * 1. POST /payments/order-payments → get Razorpay checkout params
   * 2. Open Razorpay Checkout
   * 3. On success callback: POST /payments/order-payments/verify
   * 4. On verified: redirect to payment-result page
   * 5. On dismiss: POST /payments/order-payments/cancel (best-effort)
   * 6. On failure: show inline error
   */
  async function initiatePayment() {
    if (isPaymentInFlight) return;
    if (!currentOrder) return;
    // Hard gate: payment can never start without the policy agreement
    // ticked, regardless of the button's disabled attribute.
    if (!dom.agreeCheckbox || !dom.agreeCheckbox.checked) {
      syncPaymentBtnState();
      return;
    }

    hidePaymentError();
    setPaymentProcessing('Preparing payment…');

    let checkoutData;
    try {
      // Step 1: Load Razorpay script in parallel with creating the payment order
      const [, result] = await Promise.all([
        loadRazorpayScript(),
        Api.post('/payments/order-payments', { orderId: currentOrder.id }),
      ]);
      checkoutData = result;
    } catch (err) {
      if (err instanceof ApiError) {
        if (Auth.handleSessionError(err)) return;

        // Dismiss-block: backend rejected the attempt — show live countdown.
        if (err.errorCode === 'CHECKOUT_DISMISS_BLOCKED') {
          const retryAfter = err.details && err.details.retryAfter;
          const remainingMs = retryAfter
            ? new Date(retryAfter).getTime() - Date.now()
            : 30 * 60 * 1000; // fallback: 30 min
          startDismissBlockCountdown(Math.max(remainingMs, 1000));
          return;
        }

        const message = err.status === 409
          ? (err.message || 'This order has already been paid or cannot be paid right now.')
          : (err.message || 'Could not start payment. Please try again.');
        showPaymentError(message);
      } else {
        showPaymentError('Could not start payment. Please try again.');
      }
      return;
    }

    const { checkout } = checkoutData;

    // Step 2: Open Razorpay Checkout
    // NOTE: do NOT call resetPaymentBtn() here — keep isPaymentInFlight=true
    // until the modal actually opens (rzp.open() below). Resetting early
    // allows a second click to race with the opening modal.
    setPaymentProcessing('Opening payment window…');

    const options = {
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amount,
      currency: checkout.currency,
      name: 'The Knight Club',
      description: `Order ${currentOrder.orderNumber}`,
      notes: {
        orderNumber: currentOrder.orderNumber,
      },
      // Step 3: Success callback — treated as UNVERIFIED until backend confirms
      handler: async function handleRazorpaySuccess(response) {
        setPaymentProcessing('Confirming payment…');
        try {
          const verifyResult = await Api.post('/payments/order-payments/verify', {
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });

          // Step 4: Redirect to payment-result page
          const orderId = verifyResult.order ? verifyResult.order.id : currentOrder.id;
          window.location.href = `payment-result.html?status=success&orderId=${encodeURIComponent(orderId)}`;

        } catch (err) {
          let message = 'We could not confirm your payment. Please contact support if your money was deducted.';
          if (err instanceof ApiError) {
            if (Auth.handleSessionError(err)) return;
            message = err.message || message;
          }
          showPaymentError(message);
        }
      },
      modal: {
        // Step 5: Student dismissed Checkout without paying.
        // We await the cancel API so the Payment is CANCELLED before the next
        // click arrives — this ensures a fresh Razorpay order is created
        // immediately rather than reusing the stale one.
        // The button stays disabled while the cancel request is in-flight.
        ondismiss: async function handleDismiss() {
          try {
            const cancelResult = await Api.post('/payments/order-payments/cancel', {
              razorpayOrderId: checkout.orderId,
            });

            // Backend signals a dismiss-block: student exceeded the limit.
            // Show a countdown message and keep the button disabled until then.
            const blockedUntil = cancelResult &&
              cancelResult.order &&
              cancelResult.order.checkoutBlockedUntil;

            if (blockedUntil) {
              const unblockMs = new Date(blockedUntil).getTime() - Date.now();
              if (unblockMs > 0) {
                startDismissBlockCountdown(unblockMs);
                return; // keep button disabled — countdown will re-enable it
              }
            }
          } catch (err) {
            // Cancel failed (network error, already cancelled, etc.).
            // Still reset the UI — the stale payment will expire in 30 min via
            // the server sweeper. Log for debugging; never surface to student.
            // eslint-disable-next-line no-console
            console.warn('[checkout] cancel-on-dismiss failed:', err && err.message);
          }

          resetPaymentBtn();
        },
      },
    };

    const rzp = new window.Razorpay(options);

    // Step 6: Payment failure event from Razorpay (e.g. card declined)
    rzp.on('payment.failed', function handlePaymentFailed(response) {
      const message = (response && response.error && response.error.description) ||
        'Payment could not be completed. Please try again.';
      showPaymentError(message);
    });

    // Do NOT call resetPaymentBtn() here — isPaymentInFlight must stay true
    // until ondismiss or the success handler fires. Resetting prematurely
    // allows a second click to race with an already-open Razorpay modal.
    rzp.open();
  }

  // ---- Event wiring -------------------------------------------------------
  dom.paymentBtn.addEventListener('click', initiatePayment);

  // Policy agreement: button only ever becomes enabled through
  // syncPaymentBtnState(), which always re-checks this box's state.
  if (dom.agreeCheckbox) {
    dom.agreeCheckbox.addEventListener('change', syncPaymentBtnState);
  }

  dom.retryBtn.addEventListener('click', async () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('orderId');
    window.history.replaceState({}, '', url.toString());
    await createCheckout();
  });

  dom.goCartBtn.addEventListener('click', () => {
    window.location.href = 'cart.html';
  });

  // ---- Coupon event wiring (Phase 34) ------------------------------------
  // Apply button click
  if (dom.couponApplyBtn) {
    dom.couponApplyBtn.addEventListener('click', applyCoupon);
  }

  // Enter key on coupon input
  if (dom.couponInput) {
    dom.couponInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCoupon();
      }
    });
    // Clear error message when student starts typing a new code
    dom.couponInput.addEventListener('input', () => {
      if (dom.couponMessage && !dom.couponMessage.classList.contains('is-success')) {
        hideCouponMessage();
      }
    });
  }

  // Remove coupon button click
  if (dom.couponRemoveBtn) {
    dom.couponRemoveBtn.addEventListener('click', removeCoupon);
  }

  // ---- Boot ---------------------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const existingOrderId = params.get('orderId');

  if (existingOrderId) {
    await loadExistingOrder(existingOrderId);
  } else {
    await createCheckout();
  }
})();