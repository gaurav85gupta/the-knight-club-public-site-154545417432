/**
 * Payments — thin wrapper over Api for the Phase 15 payment endpoints,
 * plus the Razorpay Checkout integration itself.
 *
 * CRITICAL ARCHITECTURE RULE (mirrors backend/src/services/payment.service.js)
 * This file NEVER decides that a payment succeeded. Razorpay Checkout's own
 * success callback is treated as UNVERIFIED — it is forwarded to the
 * backend's /payments/verify endpoint, and only that backend's response is
 * used to decide what the UI shows next. A closed/cancelled Checkout is
 * never reported as a failure to the backend (there is nothing to verify);
 * it simply leaves the payment in its existing CREATED state, which the
 * backend's own expiry handling resolves later (spec Step 28, 52-53).
 *
 * WHAT THIS FILE SENDS THE BROWSER
 * Only what POST /payments/orders returns: a Razorpay order id, the
 * PUBLIC key id, and the authoritative amount/currency the backend
 * calculated. Never a secret — there is none to send.
 */

const Payments = (() => {
  const CHECKOUT_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
  let checkoutScriptPromise = null;

  /** Loads Razorpay's Checkout script once, lazily, and caches the promise. */
  function loadCheckoutScript() {
    if (window.Razorpay) return Promise.resolve();
    if (checkoutScriptPromise) return checkoutScriptPromise;

    checkoutScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CHECKOUT_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load the payment provider. Please check your connection and try again.'));
      document.head.appendChild(script);
    });
    return checkoutScriptPromise;
  }

  /**
   * @param {string} courseId
   * @param {string} [couponCode]  optional — Phase 18 (spec Step 18-19).
   *        Sent as-is; the backend is the ONLY place that revalidates it
   *        and decides the actual order amount (spec Step 35).
   * @returns {Promise<{payment: object, checkout: object}>}
   */
  function createOrder(courseId, couponCode) {
    const body = { courseId };
    if (typeof couponCode === 'string' && couponCode.trim()) body.couponCode = couponCode.trim();
    return Api.post('/payments/orders', body);
  }

  /** @returns {Promise<{payment: object}>} */
  function verify({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    return Api.post('/payments/verify', { razorpayOrderId, razorpayPaymentId, razorpaySignature });
  }

  /** @returns {Promise<{payment: object}>} */
  function getStatus(paymentId) {
    return Api.get(`/payments/${encodeURIComponent(paymentId)}`);
  }

  /**
   * Runs the full purchase flow for one course: create the order, open
   * Razorpay Checkout, and — only on Checkout's own success callback —
   * ask the backend to verify it. Every terminal outcome is reported
   * through exactly one of the callbacks; none of them is called more
   * than once.
   *
   * @param {object} params
   * @param {string} params.courseId
   * @param {string} [params.couponCode]  optional; forwarded as-is and
   *        revalidated server-side (spec Step 18-19, 35) — this file never
   *        assumes an earlier /coupons/validate result still holds.
   * @param {{fullName?: string, mobile?: string}} [params.prefill]  from
   *        the signed-in student, for Checkout's own contact fields only
   *        (never treated as payment identity by the backend — spec Step 15)
   * @param {(payment: object) => void} params.onVerified   backend-confirmed success
   * @param {(message: string) => void} params.onFailed     backend-confirmed failure / verification error
   * @param {() => void} [params.onCancelled]                student closed Checkout
   * @param {(message: string) => void} [params.onError]     could not even start (network, order creation, script load)
   */
  async function purchaseCourse({ courseId, couponCode, prefill = {}, onVerified, onFailed, onCancelled, onError }) {
    let order;
    try {
      await loadCheckoutScript();
      order = await createOrder(courseId, couponCode);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err && err.message) || 'Something went wrong. Please try again.';
      if (onError) onError(message);
      return;
    }

    const { checkout } = order;

    const options = {
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amount,
      currency: checkout.currency,
      name: 'The Knight Club',
      description: 'Course purchase',
      prefill: {
        ...(prefill.fullName ? { name: prefill.fullName } : {}),
        ...(prefill.mobile ? { contact: prefill.mobile } : {}),
      },
      // Razorpay's own success callback. Treated as UNVERIFIED (see file
      // header) — its ONLY job here is to forward the three identifiers to
      // the backend, which recomputes the signature itself.
      handler: async function handleCheckoutSuccess(response) {
        try {
          const result = await verify({
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          });
          onVerified(result.payment);
        } catch (err) {
          const message = err instanceof ApiError ? err.message : 'We could not confirm this payment. Please contact support before trying again.';
          onFailed(message);
        }
      },
      modal: {
        // Checkout dismissed without completing — NOT a reported failure
        // (spec Step 28, 53-54): nothing was verified, so nothing is
        // marked failed. The payment order simply stays CREATED until it
        // expires or the student retries.
        ondismiss: function handleCheckoutDismiss() {
          if (onCancelled) onCancelled();
        },
      },
    };

    const razorpay = new window.Razorpay(options);
    // Razorpay's own payment-failure event (e.g. card declined) — distinct
    // from a dismissed modal. Still nothing this frontend marks as failed
    // itself; the backend's webhook is the authoritative source for a
    // FAILED state (spec Step 46), this only lets the UI show a prompt
    // message rather than waiting on nothing.
    razorpay.on('payment.failed', function handlePaymentFailed() {
      onFailed('Payment could not be completed. You can try again.');
    });
    razorpay.open();
  }

  return { createOrder, verify, getStatus, purchaseCourse };
})();
