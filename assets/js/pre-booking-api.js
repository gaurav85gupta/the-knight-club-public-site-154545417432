/**
 * PreBookingApi — thin wrapper over Api for the Phase 3 pre-booking
 * endpoints. The ONLY place that knows these URLs; pages call this module
 * rather than building paths by hand (same discipline as payments.js).
 *
 * Endpoints (all authenticated; see backend/src/routes/membership.routes.js):
 *   POST /memberships/:slug/pre-bookings            — create/resume a booking
 *   GET  /memberships/orders/:orderId/purchase       — authoritative summary
 *   PUT  /memberships/orders/:orderId/course-selection — save course picks
 *   POST /payments/order-payments                    — create payment attempt
 *   POST /payments/order-payments/verify              — verify Checkout callback
 *   POST /payments/order-payments/cancel               — cancel a dismissed Checkout
 *
 * The last three are the SAME Order-based payment routes checkout-page.js
 * uses — pre-bookings are not a second payment system (spec: "do not
 * introduce a second payment flow").
 *
 * Nothing here ever sends a price, balance, or payment status to the
 * server — every amount is read back FROM the server's response.
 */

const PreBookingApi = (() => {
  /**
   * Create or resume the student's pre-booking for a plan. Idempotent:
   * calling this again while an open booking exists returns the same one.
   * @param {string} slug  membership plan slug
   * @returns {Promise<{order: object, purchase: object, idempotent: boolean}>}
   */
  function createOrResume(slug) {
    return Api.post(`/memberships/${encodeURIComponent(slug)}/pre-bookings`, {});
  }

  /**
   * Fetch the authoritative purchase summary for a booking order. This is
   * the ONLY source of truth for stage, balances, and nextAction — never
   * recomputed on the frontend.
   * @param {string} orderId
   * @returns {Promise<object>} purchase summary (see membershipBooking.service.js#buildPurchaseSummary)
   */
  function getPurchase(orderId) {
    return Api.get(`/memberships/orders/${encodeURIComponent(orderId)}/purchase`);
  }

  /**
   * Save (or replace) the student's course selection for a pre-booked order.
   * @param {string} orderId
   * @param {string[]} selectedCourseIds
   * @returns {Promise<{order: object, purchase: object}>}
   */
  function saveCourseSelection(orderId, selectedCourseIds) {
    return Api.request(`/memberships/orders/${encodeURIComponent(orderId)}/course-selection`, {
      method: 'PUT',
      body: { selectedCourseIds },
    });
  }

  /**
   * Create a Razorpay payment attempt for whatever this order's backend-
   * resolved stage currently owes (pre-booking amount, or remaining
   * balance). The frontend never decides the amount or purpose.
   * @param {string} orderId
   * @returns {Promise<{payment: object, checkout: object, order: object}>}
   */
  function createPayment(orderId) {
    return Api.post('/payments/order-payments', { orderId });
  }

  /** @returns {Promise<{payment: object, order: object}>} */
  function verifyPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    return Api.post('/payments/order-payments/verify', { razorpayOrderId, razorpayPaymentId, razorpaySignature });
  }

  /** Best-effort cancel of a dismissed Checkout attempt. */
  function cancelPayment(razorpayOrderId) {
    return Api.post('/payments/order-payments/cancel', { razorpayOrderId });
  }

  return { createOrResume, getPurchase, saveCourseSelection, createPayment, verifyPayment, cancelPayment };
})();
