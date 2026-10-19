/**
 * Cart — the single owner of all cart API calls on the public website.
 *
 * Parallels Payments.js: pages call Cart.* instead of calling Api directly,
 * so all cart rules are in one place, never re-implemented on individual pages.
 *
 * WHAT THIS FILE IS RESPONSIBLE FOR
 * ----------------------------------
 * 1. All /cart API calls (GET, POST, DELETE).
 * 2. Maintaining a lightweight in-memory cache of the item count so the
 *    navbar badge can update without an extra round-trip after every mutation.
 * 3. Emitting change events so the navbar badge updates automatically when
 *    items are added or removed from any page.
 * 4. Providing CTA state helpers so course pages and course cards can show
 *    the correct button state (Add to Cart / In Cart / Already Purchased).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ----------------------------------
 * - Never sends prices to the server (the backend derives prices from Course).
 * - Never stores course prices locally as authoritative values.
 * - Never accepts studentId from caller code — the backend derives it from
 *   the authenticated session.
 * - Never stores full cart data persistently (localStorage/sessionStorage).
 *   The server is the source of truth; count is in-memory only.
 */

const Cart = (() => {
  // In-memory count — refreshed from the server on page load and after
  // every mutation. NOT persisted: the server is authoritative.
  let _count = null;
  const _listeners = new Set();

  // ---- Internal helpers -----------------------------------------------

  function emitCountChange(count) {
    _count = count;
    for (const fn of _listeners) {
      try { fn(count); } catch { /* broken listener must not break cart */ }
    }
  }

  // ---- Public API -------------------------------------------------------

  /**
   * Subscribes to cart count changes. `fn` is called with the new count
   * whenever the cart is mutated. Used by the navbar to update the badge.
   * @param {function(number): void} fn
   * @returns {function} unsubscribe
   */
  function onCountChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }

  /**
   * Fetches just the item count from the server. Efficient for navbar init.
   * Returns 0 on failure (unauthenticated or network error) — the badge
   * simply shows nothing rather than erroring.
   *
   * @returns {Promise<number>}
   */
  async function fetchCount() {
    try {
      const data = await Api.get('/cart/count');
      const count = (data && typeof data.count === 'number') ? data.count : 0;
      emitCountChange(count);
      return count;
    } catch {
      // Not authenticated or network error: show 0 count silently.
      emitCountChange(0);
      return 0;
    }
  }

  /**
   * Returns the cached count if available, otherwise fetches from server.
   * @returns {Promise<number>}
   */
  async function getCount() {
    if (_count !== null) return _count;
    return fetchCount();
  }

  /**
   * Fetches the full cart (course data + subtotal) from the server.
   * @returns {Promise<object>} the cart data object
   * @throws {ApiError}
   */
  async function getCart() {
    const data = await Api.get('/cart');
    if (data && typeof data.itemCount === 'number') {
      emitCountChange(data.itemCount);
    }
    return data;
  }

  /**
   * Adds a course to the cart.
   *
   * @param {string} courseId  the course's MongoDB _id (not slug)
   * @returns {Promise<{alreadyInCart: boolean, cart: object}>}
   * @throws {ApiError}  on network error, 401 (not authenticated), 409
   *   (ALREADY_OWNED — already purchased), 400 (unavailable), 422 (bad id)
   */
  async function addToCart(courseId) {
    const result = await Api.post('/cart/items', { courseId });
    if (result && result.cart && typeof result.cart.itemCount === 'number') {
      emitCountChange(result.cart.itemCount);
    }
    return result;
  }

  /**
   * Removes a course from the cart.
   *
   * @param {string} courseId
   * @returns {Promise<{wasPresent: boolean, cart: object}>}
   * @throws {ApiError}
   */
  async function removeFromCart(courseId) {
    const result = await Api.request(`/cart/items/${encodeURIComponent(courseId)}`, { method: 'DELETE' });
    if (result && result.cart && typeof result.cart.itemCount === 'number') {
      emitCountChange(result.cart.itemCount);
    }
    return result;
  }

  /**
   * Clears all items from the cart.
   *
   * @returns {Promise<object>} the empty cart
   * @throws {ApiError}
   */
  async function clearCart() {
    const result = await Api.request('/cart', { method: 'DELETE' });
    emitCountChange(0);
    return result;
  }

  /**
   * Validates the cart for checkout readiness (Phase 30 handoff).
   * @returns {Promise<object>} validation result
   */
  async function validateCart() {
    return Api.get('/cart/validate');
  }

  /**
   * Resets the in-memory count. Called on logout/session-expiry so the
   * navbar count clears without a server round-trip.
   */
  function reset() {
    emitCountChange(0);
    _count = null;
  }

  return {
    onCountChange,
    fetchCount,
    getCount,
    getCart,
    addToCart,
    removeFromCart,
    clearCart,
    validateCart,
    reset,
  };
})();
