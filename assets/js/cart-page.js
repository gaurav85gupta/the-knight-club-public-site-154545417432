/**
 * Cart page controller (Phase 29 — Cart System).
 *
 * Follows the exact same pattern as orders.js:
 *   - Auth.requireAuth() first (redirects to login if not authenticated)
 *   - Auth.guardBfcache() to handle back-forward cache
 *   - StudentShell.mount() for the shared header/footer
 *   - All DOM is built with textContent / createElement (never innerHTML + data)
 *   - All prices come from the server (Cart API) — this file never calculates
 *     or stores prices locally
 *   - Cart.* is the only API surface used for cart operations
 *
 * STATES: loading → (empty | content)
 *   loading:  skeleton cards shown while awaiting the server
 *   empty:    premium empty state with CTA to browse courses
 *   content:  two-column layout (items left, summary right)
 *
 * LOADING GUARDS: every mutating button (remove, clear, checkout) is
 * disabled during its in-flight request to prevent duplicate clicks.
 * After success or failure the button returns to its original state.
 *
 * ERRORS: API failures show a dismissible alert. Raw stack traces are
 * never shown. Session expiry is handled by Auth.handleSessionError().
 *
 * PHASE 30 BOUNDARY: "Proceed to Checkout" currently navigates to a
 * checkout route (checkout.html) which does not yet exist. The button
 * is enabled only when the cart has at least one available item. A
 * placeholder page-not-found is the graceful degradation until Phase 30
 * lands — we never pretend the checkout happened.
 */

(async function initCartPage() {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  document.documentElement.classList.remove('auth-pending');
  StudentShell.mount({ user, active: 'cart' });

  // ---- DOM refs ----------------------------------------------------------
  const els = {
    alert:      document.getElementById('cart-alert'),
    loading:    document.getElementById('cart-loading'),
    empty:      document.getElementById('cart-empty'),
    content:    document.getElementById('cart-content'),
    itemsList:  document.getElementById('cart-items-list'),
    itemsCount: document.getElementById('cart-items-count'),
    clearBtn:   document.getElementById('cart-clear-btn'),
    subtitle:   document.getElementById('cart-subtitle'),
    // summary
    coursesLabel:       document.getElementById('summary-courses-label'),
    coursesVal:         document.getElementById('summary-courses-val'),
    subtotalVal:        document.getElementById('summary-subtotal'),
    unavailableNotice:  document.getElementById('cart-unavailable-notice'),
    unavailableText:    document.getElementById('cart-unavailable-text'),
    checkoutBtn:        document.getElementById('cart-checkout-btn'),
    selectAll:          document.getElementById('cart-select-all'),
    subtotalLabel:      document.getElementById('summary-subtotal-label'),
    selectionNote:      document.getElementById('cart-selection-note'),
  };

  const { el } = StudentUI;

  // ---- State -------------------------------------------------------------
  let _cartData = null;      // last fetched cart response from server
  let _clearInFlight = false;
  const _selectedCourseIds = new Set(); // courseIds the student has checked

  // ---- Helpers -----------------------------------------------------------

  function showState(name) {
    els.loading.hidden = name !== 'loading';
    els.empty.hidden   = name !== 'empty';
    els.content.hidden = name !== 'content';
  }

  function formatSubtotal(minorUnits) {
    if (!minorUnits && minorUnits !== 0) return '—';
    if (minorUnits === 0) return 'Free';
    const symbol = '₹';
    const major = (minorUnits / 100).toLocaleString('en-IN', {
      maximumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
    });
    return `${symbol}${major}`;
  }

  function pluralise(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  // ---- Cart item rendering -----------------------------------------------

  /** Thumbnail element — matches the pattern used in orders.js / dashboard.js */
  function thumbEl(item) {
    const wrap = el('div', 'cart-item-thumb');
    if (item.thumbnail) {
      const img = document.createElement('img');
      img.src = item.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      wrap.appendChild(img);
    } else {
      const fb = el('div', 'thumb-fallback');
      fb.setAttribute('aria-hidden', 'true');
      fb.textContent = (item.title || '?').charAt(0).toUpperCase();
      wrap.appendChild(fb);
    }
    return wrap;
  }

  /** Price display for one cart item. */
  function pricingEl(item) {
    const wrap = el('div', 'cart-item-pricing');
    if (!item.pricing) return wrap;

    if (item.pricing.isFree) {
      wrap.appendChild(el('span', 'cart-item-free', 'Free'));
      return wrap;
    }

    const sale = formatSubtotal(item.pricing.salePrice);
    wrap.appendChild(el('span', 'cart-item-price', sale));

    const orig = Format.originalPrice(item.pricing);
    if (orig) {
      wrap.appendChild(el('span', 'cart-item-original', orig));
    }
    return wrap;
  }

  /**
   * Builds one cart item row. Returns the article element AND a ref to the
   * remove button so the listener can be wired after the fragment is built.
   */
  function buildCartItem(item) {
    const article = document.createElement('article');
    article.className = `cart-item${item.available ? '' : ' is-unavailable'}`;
    article.setAttribute('role', 'listitem');
    article.dataset.courseId = item.courseId;

    // Selection checkbox — lets the student pick a subset of the cart to
    // check out. Only available items are selectable; an unavailable item
    // cannot be purchased so there is nothing to select.
    let selectCheckbox = null;
    if (item.available) {
      const selectWrap = el('div', 'cart-item-select');
      selectCheckbox = document.createElement('input');
      selectCheckbox.type = 'checkbox';
      selectCheckbox.className = 'cart-item-checkbox';
      selectCheckbox.dataset.courseId = item.courseId;
      selectCheckbox.setAttribute('aria-label', `Select ${item.title || 'course'} for checkout`);
      selectWrap.appendChild(selectCheckbox);
      article.appendChild(selectWrap);
    }

    // Thumbnail
    article.appendChild(thumbEl(item));

    // Body
    const body = el('div', 'cart-item-body');

    // Title (linked to course page if slug available and course is available)
    const titleEl = el('p', 'cart-item-title');
    if (item.slug && item.available) {
      const a = document.createElement('a');
      a.href = `course.html?slug=${encodeURIComponent(item.slug)}`;
      a.textContent = item.title || 'Untitled Course';
      titleEl.appendChild(a);
    } else {
      titleEl.textContent = item.title || 'Course unavailable';
    }
    body.appendChild(titleEl);

    // Instructor
    if (item.instructor && item.instructor.name) {
      body.appendChild(el('p', 'cart-item-instructor', `By ${item.instructor.name}`));
    }

    // Unavailable pill
    if (!item.available) {
      const pill = el('span', 'cart-item-unavailable-pill');
      pill.setAttribute('role', 'status');
      pill.textContent = item.deletedCourse ? 'No longer available' : 'Currently unavailable';
      body.appendChild(pill);
    }

    // Pricing (only for available items with a price)
    if (item.available) {
      body.appendChild(pricingEl(item));
    }

    // Actions: Remove + View Course
    const actions = el('div', 'cart-item-actions');

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'cart-item-remove';
    removeBtn.dataset.courseId = item.courseId;
    removeBtn.setAttribute('aria-label', `Remove ${item.title || 'course'} from cart`);
    removeBtn.textContent = 'Remove';

    actions.appendChild(removeBtn);

    if (item.slug && item.available) {
      const viewLink = document.createElement('a');
      viewLink.href = `course.html?slug=${encodeURIComponent(item.slug)}`;
      viewLink.className = 'cart-item-view';
      viewLink.textContent = 'View Course';
      viewLink.setAttribute('aria-label', `View details for ${item.title || 'course'}`);
      actions.appendChild(viewLink);
    }

    body.appendChild(actions);
    article.appendChild(body);

    return { article, removeBtn, selectCheckbox };
  }

  // ---- Summary rendering -------------------------------------------------

  /** Sum of pricing.salePrice (minor units) for the given available items. */
  function sumSelectedSubtotal(items, courseIdSet) {
    let sum = 0;
    for (const item of items) {
      if (!item.available || !item.pricing) continue;
      if (!courseIdSet.has(item.courseId)) continue;
      sum += item.pricing.isFree ? 0 : (item.pricing.salePrice || 0);
    }
    return sum;
  }

  function renderSummary(cartData) {
    const { summary, items } = cartData;
    const n = summary.availableCount;
    const selectedCount = _selectedCourseIds.size;
    const hasSelection = selectedCount > 0;

    if (hasSelection) {
      // Selection-aware summary: counts/subtotal reflect only checked items.
      els.coursesLabel.textContent = selectedCount === 1 ? 'Selected' : 'Selected';
      els.coursesVal.textContent = pluralise(selectedCount, 'course');
      els.subtotalLabel.textContent = 'Subtotal';
      const selectedSubtotal = sumSelectedSubtotal(items, _selectedCourseIds);
      els.subtotalVal.textContent = formatSubtotal(selectedSubtotal);
    } else {
      // No selection: summary reflects the whole (available) cart, as before.
      els.coursesLabel.textContent = n === 1 ? 'Course' : 'Courses';
      els.coursesVal.textContent = pluralise(n, 'course');
      els.subtotalLabel.textContent = 'Subtotal';
      els.subtotalVal.textContent = n > 0 ? formatSubtotal(summary.subtotal) : '—';
    }

    // Unavailable notice
    if (summary.unavailableCount > 0) {
      els.unavailableText.textContent =
        `${pluralise(summary.unavailableCount, 'item')} in your cart ${summary.unavailableCount === 1 ? 'is' : 'are'} currently unavailable and won't be charged.`;
      els.unavailableNotice.hidden = false;
    } else {
      els.unavailableNotice.hidden = true;
    }

    // Selection helper note
    if (hasSelection && n > 0 && selectedCount < n) {
      els.selectionNote.textContent = `Checking out ${pluralise(selectedCount, 'course')} of ${n} in your cart.`;
      els.selectionNote.hidden = false;
    } else {
      els.selectionNote.hidden = true;
    }

    // Checkout button: enabled only when there are purchasable items.
    // Label follows selection — "Checkout Selected (n)" vs the full-cart CTA.
    els.checkoutBtn.disabled = n === 0;
    els.checkoutBtn.title = n === 0
      ? 'Remove unavailable items or add a course to proceed'
      : '';
    setCheckoutBtnLabel(hasSelection ? selectedCount : 0);

    // Select-all checkbox tri-state
    if (els.selectAll) {
      els.selectAll.disabled = n === 0;
      els.selectAll.checked = n > 0 && selectedCount === n;
      els.selectAll.indeterminate = selectedCount > 0 && selectedCount < n;
    }
  }

  /** Updates the checkout button's visible label/arrow based on selection. */
  function setCheckoutBtnLabel(selectedCount) {
    // Preserve the trailing arrow svg; only swap the text node.
    const arrow = els.checkoutBtn.querySelector('.btn-arrow');
    els.checkoutBtn.textContent = selectedCount > 0
      ? `Checkout Selected (${selectedCount}) `
      : 'Proceed to Checkout ';
    if (arrow) els.checkoutBtn.appendChild(arrow);
  }

  // ---- Render full cart --------------------------------------------------

  function renderCart(cartData) {
    _cartData = cartData;

    if (!cartData.itemCount || cartData.itemCount === 0) {
      showState('empty');
      return;
    }

    // Drop any selected courseIds that are no longer in the cart (e.g. a
    // concurrent remove/clear on another tab, or a just-removed item).
    const currentIds = new Set(cartData.items.map((item) => item.courseId));
    for (const id of [..._selectedCourseIds]) {
      if (!currentIds.has(id)) _selectedCourseIds.delete(id);
    }

    // Items count label
    els.itemsCount.textContent = pluralise(cartData.itemCount, 'course');

    // Build item nodes
    const frag = document.createDocumentFragment();
    for (const item of cartData.items) {
      const { article, removeBtn, selectCheckbox } = buildCartItem(item);
      removeBtn.addEventListener('click', () => handleRemove(item.courseId, item.title, removeBtn));
      if (selectCheckbox) {
        selectCheckbox.checked = _selectedCourseIds.has(item.courseId);
        selectCheckbox.addEventListener('change', () => {
          if (selectCheckbox.checked) _selectedCourseIds.add(item.courseId);
          else _selectedCourseIds.delete(item.courseId);
          renderSummary(_cartData);
        });
      }
      frag.appendChild(article);
    }
    els.itemsList.replaceChildren(frag);

    // Summary panel
    renderSummary(cartData);

    showState('content');
  }

  // ---- Load cart ---------------------------------------------------------

  async function loadCart() {
    Forms.hideAlert(els.alert);
    showState('loading');
    try {
      const cartData = await Cart.getCart();
      renderCart(cartData);
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      // On hard error, still show empty rather than leaving the skeleton.
      showState('empty');
      Forms.showAlert(els.alert, err.message || 'Unable to load your cart. Please try again.', 'error');
    }
  }

  // ---- Remove item -------------------------------------------------------

  async function handleRemove(courseId, courseTitle, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Removing…';
    Forms.hideAlert(els.alert);

    try {
      const { cart } = await Cart.removeFromCart(courseId);
      _selectedCourseIds.delete(courseId);
      StudentUI.toast(`Removed from cart.`, 'success');
      renderCart(cart);
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      btn.disabled = false;
      btn.textContent = 'Remove';
      Forms.showAlert(els.alert, err.message || 'Could not remove item. Please try again.', 'error');
    }
  }

  // ---- Clear cart --------------------------------------------------------

  async function handleClear() {
    if (_clearInFlight) return;
    _clearInFlight = true;
    els.clearBtn.disabled = true;
    els.clearBtn.textContent = 'Clearing…';
    Forms.hideAlert(els.alert);

    try {
      const cart = await Cart.clearCart();
      _selectedCourseIds.clear();
      StudentUI.toast('Cart cleared.', 'success');
      renderCart(cart);
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      Forms.showAlert(els.alert, err.message || 'Could not clear cart. Please try again.', 'error');
    } finally {
      _clearInFlight = false;
      els.clearBtn.disabled = false;
      els.clearBtn.textContent = 'Remove all';
    }
  }

  // ---- Select all ----------------------------------------------------------

  function handleSelectAllChange() {
    if (!_cartData || !_cartData.items) return;
    if (els.selectAll.checked) {
      for (const item of _cartData.items) {
        if (item.available) _selectedCourseIds.add(item.courseId);
      }
    } else {
      _selectedCourseIds.clear();
    }
    // Re-render item checkboxes to match the new selection state.
    renderCart(_cartData);
  }

  // ---- Checkout ----------------------------------------------------------
  // Phase 30 boundary: navigate to checkout. If checkout.html doesn't exist
  // yet, the browser shows 404. We do NOT pretend payment happened.
  //
  // SELECTIVE CHECKOUT: if the student has checked specific courses, only
  // those are sent to checkout.html (via sessionStorage — the same tab,
  // read once on the checkout page and then cleared). Leaving everything
  // unchecked behaves exactly as before: the whole cart checks out.

  const CHECKOUT_SELECTION_KEY = 'tkc_checkout_selection';

  function handleCheckout() {
    if (!_cartData || !_cartData.summary || _cartData.summary.availableCount === 0) return;

    if (_selectedCourseIds.size > 0) {
      try {
        sessionStorage.setItem(CHECKOUT_SELECTION_KEY, JSON.stringify([..._selectedCourseIds]));
      } catch {
        // sessionStorage unavailable (private mode, etc.) — fall back to
        // full-cart checkout rather than blocking the student.
      }
    } else {
      try { sessionStorage.removeItem(CHECKOUT_SELECTION_KEY); } catch { /* ignore */ }
    }

    window.location.href = 'checkout.html';
  }

  // ---- Wire events -------------------------------------------------------

  els.clearBtn.addEventListener('click', handleClear);
  els.checkoutBtn.addEventListener('click', handleCheckout);
  if (els.selectAll) els.selectAll.addEventListener('change', handleSelectAllChange);

  // ---- Boot --------------------------------------------------------------

  await loadCart();
})();
