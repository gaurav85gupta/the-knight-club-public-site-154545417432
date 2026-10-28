/**
 * pre-booking-info.js — "How pre-booking works" page.
 *
 * Shows the terms, fills the amounts from the live plan (never hardcoded),
 * and on Continue runs the SAME flow the 1% Club page used before:
 *   sign-in check -> already-a-member check -> POST /memberships/:slug/pre-bookings
 *   -> redirect to pre-booking.html (the existing payment page).
 * No amount is ever sent to the server from here.
 */
(function () {
  'use strict';

  var qs = new URLSearchParams(window.location.search);
  var slugParam = qs.get('slug') || '';
  var PLAN_SLUG = /^[a-z0-9-]{1,80}$/i.test(slugParam) ? slugParam : '1-percent-club';

  function $(id) { return document.getElementById(id); }

  var alertEl = $('pbi-alert');
  var agree = $('pbi-agree');
  var btn = $('pbi-continue');
  var hint = $('pbi-hint');
  var spinner = btn && btn.querySelector('.pbi-spinner');
  var label = btn && btn.querySelector('.pbi-continue-label');
  var LABEL_DEFAULT = 'Continue to payment';

  var unavailable = false; // set when the backend says pre-booking is off
  var busy = false;

  function money(minorUnits, currency) {
    var symbol = (currency === 'INR' || !currency) ? '\u20B9' : (currency + ' ');
    var major = (minorUnits / 100).toLocaleString('en-IN', {
      maximumFractionDigits: (minorUnits % 100 === 0) ? 0 : 2,
    });
    return symbol + major;
  }

  function showAlert(html) {
    alertEl.innerHTML = html;
    alertEl.hidden = false;
  }

  function syncButton() {
    var ok = agree && agree.checked && !unavailable && !busy;
    btn.disabled = !ok;
    btn.setAttribute('aria-disabled', String(!ok));
    if (unavailable) hint.textContent = 'Pre-booking is not available right now.';
    else hint.textContent = agree.checked ? 'You will be taken to the secure payment page next.' : 'Tick the box above to continue.';
  }

  // ---- Fill amounts from the live plan -------------------------------------
  function renderPlan(plan) {
    if (!plan) return;
    var pb = plan.preBooking;
    if (!pb || pb.enabled !== true || typeof pb.amount !== 'number') {
      unavailable = true;
      showAlert('Pre-booking is not available for this plan right now. <a href="one-percent-club.html">Back to the 1% Club page</a>.');
      syncButton();
      return;
    }
    $('pbi-f-pre').textContent = money(pb.amount, plan.currency);
    if (typeof plan.price === 'number') {
      $('pbi-f-price').textContent = money(plan.price, plan.currency);
      $('pbi-f-balance').textContent = money(Math.max(0, plan.price - pb.amount), plan.currency);
    }
    if (plan.selectionLimit && plan.eligibleCourseCount) {
      $('pbi-f-courses').textContent = plan.selectionLimit + ' of ' + plan.eligibleCourseCount;
    }
    $('pbi-facts').hidden = false;
  }

  function loadPlan() {
    if (typeof Api === 'undefined') return;
    Api.get('/memberships/' + encodeURIComponent(PLAN_SLUG))
      .then(renderPlan)
      .catch(function () { /* page still readable; the server decides at Continue */ });
  }

  // ---- Continue --------------------------------------------------------------
  function checkExistingMembership() {
    return Api.get('/students/orders?status=PAID&limit=50')
      .then(function (data) {
        var items = (data && data.items) || [];
        return items.some(function (o) { return o.kind === 'MEMBERSHIP' && o.status === 'PAID'; });
      })
      .catch(function () { return false; }); // non-blocking, same as the 1% Club page
  }

  function setBusy(on) {
    busy = on;
    if (spinner) spinner.hidden = !on;
    if (label) label.textContent = on ? 'Please wait\u2026' : LABEL_DEFAULT;
    syncButton();
  }

  function onContinue() {
    if (busy || !agree.checked || unavailable) return;
    if (typeof Auth === 'undefined' || !Auth.requireAuth) {
      window.location.href = 'login.html?next=' + encodeURIComponent(window.location.pathname + window.location.search);
      return;
    }
    alertEl.hidden = true;
    setBusy(true);

    Auth.requireAuth()
      .then(checkExistingMembership)
      .then(function (isMember) {
        if (isMember) {
          setBusy(false);
          showAlert('You are already a 1% Club member, so you do not need to pre-book. <a href="dashboard.html">Go to My Learning</a>.');
          return null;
        }
        // Idempotent: creates the booking or resumes the open one.
        return Api.post('/memberships/' + encodeURIComponent(PLAN_SLUG) + '/pre-bookings', {})
          .then(function (data) {
            var order = data && data.order;
            if (!order || !order.id) {
              setBusy(false);
              showAlert('We could not start your booking. Please try again.');
              return;
            }
            window.location.href = 'pre-booking.html?orderId=' + encodeURIComponent(order.id) +
              '&slug=' + encodeURIComponent(PLAN_SLUG);
          });
      })
      .catch(function (err) {
        var status = (err && err.status) || 0;
        if (status === 401 || status === 403) {
          if (typeof Auth !== 'undefined' && Auth.handleSessionError) Auth.handleSessionError(err);
          return;
        }
        setBusy(false);
        if (status === 409 || status === 404) {
          unavailable = true;
          syncButton();
          showAlert('Pre-booking is not available for this plan right now. <a href="one-percent-club.html">Back to the 1% Club page</a>.');
        } else {
          showAlert((err && err.message) || 'Something went wrong. Please try again.');
        }
      });
  }

  if (agree && btn) {
    agree.addEventListener('change', syncButton);
    btn.addEventListener('click', onContinue);
    syncButton();
  }
  loadPlan();
})();
