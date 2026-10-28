/**
 * 1% Club page — Phase 36: Complete Student-Facing Purchase Experience.
 *
 * =========================================================================
 * ARCHITECTURE OVERVIEW
 * =========================================================================
 *
 * This script is fully API-driven. ALL configuration is fetched from the
 * backend at runtime:
 *   - plan.selectionLimit  (NEVER hardcoded as "4")
 *   - plan.eligibleCourseCount  (NEVER hardcoded as "7")
 *   - plan.courses  (NEVER hardcoded course list)
 *   - plan.price  (NEVER hardcoded price)
 *   - plan.benefits  (NEVER hardcoded benefits)
 *
 * The sentence "Choose any 4 of 7 courses" is DERIVED:
 *   plan.selectionLimit + " of " + plan.eligibleCourseCount + " courses"
 *
 * When an admin changes selectionLimit to 5 or courses to 10, this page
 * immediately displays "Choose any 5 of 10 courses" — no code change needed.
 *
 * =========================================================================
 * PAGE FLOW (three views on a single page)
 * =========================================================================
 *
 * VIEW: SELECTION   (default, unauthenticated browsing is OK)
 *   - Loads plan from GET /api/v1/memberships/:slug
 *   - Shows course picker, selection counter, dynamic CTA
 *   - "Continue to Checkout" → triggers auth check → member check → REVIEW
 *
 * VIEW: REVIEW      (requires auth)
 *   - Shows summary of plan + selected courses + price
 *   - "Edit Selection" → back to SELECTION
 *   - "Continue to Checkout" → creates membership order → checkout.html
 *
 * VIEW: MEMBER      (shown when student already has active/paid membership)
 *   - Checks GET /students/orders for a PAID MEMBERSHIP order
 *   - Provides link to My Learning
 *
 * =========================================================================
 * BACKEND ENDPOINTS USED
 * =========================================================================
 *
 * GET  /api/v1/memberships/:slug           — plan config (public)
 * GET  /api/v1/students/orders            — check existing membership (auth)
 * POST /api/v1/memberships/:slug/orders    — create membership order (auth)
 *   Body: { selectedCourseIds: [...] }
 *   The backend validates count, eligibility, deduplication.
 *   Price is NEVER sent from client — backend reads from MembershipPlan.
 *
 * POST /api/v1/payments/order-payments     — create Razorpay payment (auth)
 * POST /api/v1/payments/order-payments/verify  — verify payment callback
 * POST /api/v1/payments/order-payments/cancel  — cancel dismissed checkout
 *
 * =========================================================================
 * SECURITY PROPERTIES (verified)
 * =========================================================================
 *
 * ✓ Authentication required for purchase (via Auth.requireAuth)
 * ✓ Student identity from session cookie (never from frontend)
 * ✓ Membership price from server (never sent from client)
 * ✓ Selection limit from server (used for UX only; backend enforces)
 * ✓ Eligible courses from server (backend rejects ineligible)
 * ✓ Final amount from server (POST /payments/order-payments reads Order.total)
 * ✓ Coupon at checkout ONLY (not here — redirect to checkout.html with orderId)
 * ✓ Payment uses existing /payments/order-payments route (not a new endpoint)
 * ✓ No duplicate Order (idempotency via 5-min window in membership.service.js)
 * ✓ No duplicate Enrollment (Phase 32 fulfilment sweep is idempotent)
 * ✓ Existing PAID membership detected from server — member view shown
 */
(function () {
  'use strict';

  /** Membership plan slug — stable public identifier. */
  var PLAN_SLUG = '1-percent-club';

  // Strips/forces off any autoplay the backend's embedUrl may carry in its
  // own query string (e.g. "...?autoplay=true"). The iframe `allow`
  // attribute only revokes the BROWSER PERMISSION to autoplay — it does
  // nothing about the player itself requesting a muted autoplay, which some
  // browsers grant anyway. Forcing the param off in the URL is what actually
  // stops a visitor landing on the page and a video starting on its own.
  // Shared by both video embeds on this page (Section 2 intro video and the
  // video testimonials further down).
  function withAutoplayOff(u) {
    try {
      var parsed = new URL(u);
      parsed.searchParams.set('autoplay', 'false');
      return parsed.toString();
    } catch (e) {
      return u; // malformed URL: the caller's own host check rejects it before this runs
    }
  }

  // -------------------------------------------------------------------------
  // Page views: 'selection' | 'review' | 'loading' | 'error' | 'member'
  // -------------------------------------------------------------------------
  var VIEW_IDS = {
    selection: 'oc-view-selection',
    review:    'oc-view-review',
    loading:   'oc-view-loading',
    error:     'oc-view-error',
    member:    'oc-view-member',
  };

  // -------------------------------------------------------------------------
  // State — all sourced from API, never hardcoded
  // -------------------------------------------------------------------------
  var plan          = null;    // full plan object from API
  var selectionLimit = 0;      // plan.selectionLimit (server-driven)
  var selectedIds   = [];      // array of course IDs (preserving order)
  var currentView   = null;    // active view name

  // -------------------------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls)  n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function $(id) { return document.getElementById(id); }

  function showView(name) {
    Object.keys(VIEW_IDS).forEach(function (key) {
      var node = $(VIEW_IDS[key]);
      if (node) node.hidden = (key !== name);
    });
    currentView = name;
    // Sticky bar is only shown during the selection view
    updateStickyVisibility();
  }

  // -------------------------------------------------------------------------
  // Money formatting (mirrors StudentUI.money)
  // -------------------------------------------------------------------------
  function money(minorUnits, currency) {
    var symbol = (currency === 'INR' || !currency) ? '\u20B9' : (currency + ' ');
    var major = (minorUnits / 100).toLocaleString('en-IN', {
      maximumFractionDigits: (minorUnits % 100 === 0) ? 0 : 2,
    });
    return symbol + major;
  }

  // -------------------------------------------------------------------------
  // Shared "Join for ₹X" label — used by the hero CTA, section CTA and
  // sticky bar once the student has picked all their courses. Falls back
  // to a plain "Continue to Checkout" if the plan has no price yet.
  // -------------------------------------------------------------------------
  function joinForPriceLabel() {
    var priceLabel = (plan && plan.price != null) ? money(plan.price, plan.currency) : '';
    return priceLabel ? ('Join for ' + priceLabel) : 'Continue to Checkout';
  }

  // -------------------------------------------------------------------------
  // Sticky bar
  // -------------------------------------------------------------------------
  var stickyEl = $('oc-sticky');
  var stickyShownOnce = false;

  function updateStickyVisibility() {
    if (!stickyEl) return;
    // Only show sticky bar when in selection view
    var inSelection = (currentView === 'selection');
    stickyEl.classList.toggle('is-visible', inSelection);
  }

  function refreshStickyBar(count) {
    var stickyCount = $('oc-sticky-count');
    if (stickyCount) {
      stickyCount.textContent = count + ' of ' + selectionLimit + ' selected';
      stickyCount.classList.toggle('is-full', count === selectionLimit && selectionLimit > 0);
    }
    var stickyCta = $('oc-sticky-cta');
    if (stickyCta) {
      var complete = (selectionLimit > 0 && count === selectionLimit);
      stickyCta.disabled = !complete;
      stickyCta.setAttribute('aria-disabled', String(!complete));
      stickyCta.textContent = complete ? joinForPriceLabel() : ('Select ' + (selectionLimit - count) + ' more');
    }
  }

  // -------------------------------------------------------------------------
  // Selection state helpers
  // -------------------------------------------------------------------------

  function isSelected(courseId) {
    return selectedIds.indexOf(courseId) !== -1;
  }

  function toggleCourse(courseId) {
    var idx = selectedIds.indexOf(courseId);
    if (idx !== -1) {
      // Deselect
      selectedIds.splice(idx, 1);
    } else if (selectedIds.length < selectionLimit) {
      // Select (only if under limit)
      selectedIds.push(courseId);
    }
    refreshSelectionUI();
  }

  var selectionComplete = false;

  function refreshSelectionUI() {
    var count = selectedIds.length;
    selectionComplete = (selectionLimit > 0 && count === selectionLimit);

    // Counter badge
    var counterEl = $('oc-count');
    if (counterEl) {
      counterEl.textContent = count + ' of ' + selectionLimit + ' selected';
      counterEl.classList.toggle('is-full', selectionComplete);
    }

    // Sticky bar
    refreshStickyBar(count);

    // Update each course card
    var cards = document.querySelectorAll('.oc-course');
    cards.forEach(function (card) {
      var cId = card.dataset.courseId;
      var on  = isSelected(cId);
      var btn = card.querySelector('.oc-pick');
      card.classList.toggle('is-on', on);
      if (btn) {
        btn.setAttribute('aria-pressed', String(on));
        btn.disabled = (!on && count >= selectionLimit);
        if (on) {
          btn.setAttribute('aria-label', 'Deselect ' + (card.querySelector('.oc-ctitle') ? card.querySelector('.oc-ctitle').textContent : 'course'));
        } else {
          btn.setAttribute('aria-label', 'Select ' + (card.querySelector('.oc-ctitle') ? card.querySelector('.oc-ctitle').textContent : 'course') + ' for your membership');
        }
      }
    });

    // Primary CTA
    var cta = $('oc-cta');
    if (cta) {
      if (selectionComplete) {
        cta.textContent = joinForPriceLabel();
        cta.disabled    = false;
        cta.removeAttribute('aria-disabled');
      } else {
        var remaining = selectionLimit - count;
        cta.textContent = 'Select ' + remaining + ' more course' + (remaining === 1 ? '' : 's');
        cta.disabled    = true;
        cta.setAttribute('aria-disabled', 'true');
      }
    }

    // Section CTA
    var sectCta = $('oc-section-cta');
    if (sectCta) {
      if (selectionComplete) {
        sectCta.textContent = joinForPriceLabel();
        sectCta.disabled    = false;
        sectCta.removeAttribute('aria-disabled');
      } else {
        var rem2 = selectionLimit - count;
        sectCta.textContent = 'Select ' + rem2 + ' more course' + (rem2 === 1 ? '' : 's');
        sectCta.disabled    = true;
        sectCta.setAttribute('aria-disabled', 'true');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Course card builder
  // -------------------------------------------------------------------------
  function buildCard(c) {
    var article = el('article', 'oc-course');
    article.dataset.courseId = c.id;
    article.setAttribute('role', 'group');
    article.setAttribute('aria-label', c.title);
    article.tabIndex = 0;

    // Thumbnail
    var thumb = el('div', 'oc-thumb');
    if (c.thumbnail) {
      var img = document.createElement('img');
      img.src = c.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 640;
      img.height = 360;
      img.addEventListener('error', function () {
        img.remove();
        var fb = el('div', 'oc-thumb-initials', String(c.title || '').split(/\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase());
        thumb.appendChild(fb);
      });
      thumb.appendChild(img);
    } else {
      var initials = String(c.title || '').split(/\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase();
      thumb.appendChild(el('div', 'oc-thumb-initials', initials));
    }

    // Body
    var body = el('div', 'oc-cbody');
    body.appendChild(el('h3', 'oc-ctitle', c.title));

    if (c.shortDescription) {
      var desc = c.shortDescription.length > 120
        ? c.shortDescription.slice(0, 117) + '\u2026'
        : c.shortDescription;
      body.appendChild(el('p', 'oc-cdesc', desc));
    }

    // Footer with view link + select button
    var foot = el('div', 'oc-cfoot');

    var viewLink = el('a', 'oc-clink', 'View course');
    viewLink.href = 'course.html?slug=' + encodeURIComponent(c.slug);
    viewLink.setAttribute('aria-label', 'View course: ' + c.title);
    foot.appendChild(viewLink);

    var btn = el('button', 'oc-pick', 'Select');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Select ' + c.title + ' for your membership');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleCourse(c.id);
    });
    foot.appendChild(btn);

    body.appendChild(foot);
    article.appendChild(thumb);
    article.appendChild(body);

    // Card keyboard support
    article.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCourse(c.id);
      }
    });

    // Card click to toggle (excluding link/button)
    article.addEventListener('click', function (e) {
      if (e.target.closest('a') || e.target.closest('button')) return;
      toggleCourse(c.id);
    });

    return article;
  }

  // -------------------------------------------------------------------------
  // Update page meta elements from plan data
  // -------------------------------------------------------------------------
  function updatePageMeta() {
    if (!plan) return;
    var limit = plan.selectionLimit;
    var total = plan.eligibleCourseCount;

    // "Choose any N of M courses" elements
    var selTextEls = document.querySelectorAll('[data-oc-selection-text]');
    selTextEls.forEach(function (e) {
      e.textContent = 'Choose any ' + limit + ' of ' + total + ' courses';
    });

    // Raw limit number placeholders
    document.querySelectorAll('[data-oc-limit]').forEach(function (e) {
      e.textContent = String(limit);
    });

    // Raw total number placeholders
    document.querySelectorAll('[data-oc-total]').forEach(function (e) {
      e.textContent = String(total);
    });

    // Price display
    document.querySelectorAll('[data-oc-price]').forEach(function (e) {
      e.textContent = money(plan.price, plan.currency);
    });

    // Compare-at (strikethrough) price
    if (plan.compareAtPrice) {
      document.querySelectorAll('[data-oc-compare-price]').forEach(function (e) {
        e.textContent = money(plan.compareAtPrice, plan.currency);
        e.hidden = false;
      });
      // Plain-text version used inside the hero's "offer ends" sentence
      // (e.g. "...automatically become ₹10,000."), plus the sentence itself.
      document.querySelectorAll('[data-oc-compare-price-text]').forEach(function (e) {
        e.textContent = money(plan.compareAtPrice, plan.currency);
      });
      document.querySelectorAll('[data-oc-offer-note]').forEach(function (e) {
        e.hidden = false;
      });
    } else {
      // No future higher price configured — the sentence has nothing to
      // say, so hide it rather than show a dangling "...become ." fragment.
      document.querySelectorAll('[data-oc-offer-note]').forEach(function (e) {
        e.hidden = true;
      });
    }

    // Plan name
    document.querySelectorAll('[data-oc-plan-name]').forEach(function (e) {
      e.textContent = plan.name;
    });

    // Benefits list
    var benefitsEl = $('oc-benefits-list');
    if (benefitsEl && Array.isArray(plan.benefits) && plan.benefits.length) {
      benefitsEl.innerHTML = '';
      plan.benefits.forEach(function (b) {
        benefitsEl.appendChild(el('li', 'oc-benefit', b));
      });
      var benefitsWrap = benefitsEl.closest('[data-oc-benefits]');
      if (benefitsWrap) benefitsWrap.hidden = false;
    }

    // Refresh counter to show 0/N
    var counterEl = $('oc-count');
    if (counterEl) {
      counterEl.textContent = '0 of ' + limit + ' selected';
    }
    refreshStickyBar(0);

    // Phase 3: Pre-Book entry point. plan.preBooking is the PUBLIC, safe
    // shape from toSafeMembershipPlan — it is already {enabled, amount,
    // remainingAmount} and already reflects "valid" server-side (an
    // enabled-but-misconfigured plan reports enabled:false here). Nothing
    // about availability is inferred client-side (spec: "Do not infer
    // availability only from frontend defaults").
    updatePreBookRow();
  }

  // -------------------------------------------------------------------------
  // Phase 3: Pre-Book row visibility + amount display.
  // -------------------------------------------------------------------------
  function updatePreBookRow() {
    var row = $('oc-prebook-row');
    if (!row) return;
    var pb = plan && plan.preBooking;
    if (pb && pb.enabled === true && typeof pb.amount === 'number') {
      var amountEl = $('oc-prebook-amount');
      if (amountEl) amountEl.textContent = money(pb.amount, plan.currency);
      row.hidden = false;
    } else {
      row.hidden = true;
    }
  }

  // -------------------------------------------------------------------------
  // Load state message (in the course grid area)
  // -------------------------------------------------------------------------
  function setGridState(msg, canRetry) {
    var wrap = $('oc-courses');
    if (!wrap) return;
    wrap.innerHTML = '';
    var p = el('p', 'oc-state', msg);
    if (canRetry) {
      var retryBtn = el('button', 'btn btn-outline btn-sm', 'Try again');
      retryBtn.type = 'button';
      retryBtn.style.marginLeft = '1rem';
      retryBtn.addEventListener('click', load);
      p.appendChild(retryBtn);
    }
    wrap.appendChild(p);
  }

  // -------------------------------------------------------------------------
  // Check if the authenticated student already has an active 1% Club membership
  // Returns true if a PAID MEMBERSHIP order exists for this plan slug.
  // Uses GET /students/orders — existing Phase 33 endpoint.
  // -------------------------------------------------------------------------
  function checkExistingMembership() {
    // GET /students/orders?status=PAID&limit=50
    // We look for kind === 'MEMBERSHIP' in the returned items.
    // The backend always scopes this to the authenticated student via session.
    // Uses Api.get() so CONFIG.API_BASE_URL is always respected (no relative-URL fallback).
    return Api.get('/students/orders?status=PAID&limit=50')
      .then(function (data) {
        if (!data || !data.items) return false;
        var items = data.items;
        // Look for a PAID MEMBERSHIP order
        return items.some(function (order) {
          return order.kind === 'MEMBERSHIP' && order.status === 'PAID';
        });
      })
      .catch(function () {
        return false; // Non-blocking: ignore errors, let purchase continue
      });
  }

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Phase 39: Apply dynamic media / content configuration from the plan API.
  //
  // Called once, after the plan is fetched. Graceful: any missing optional
  // field falls back to the existing static HTML — the page never breaks.
  //
  // plan.media:
  //   founderImage  — Bunny CDN URL for the founder photo (Section E)
  //   introVideo    — { embedUrl, expiresAt } | null  (Section B)
  //
  // plan.content:
  //   section2Heading     — override for the "What Is the 1% Club?" heading
  //   section2Description — override for the first paragraph in Section B
  //
  // SECURITY: embedUrl comes from the backend (signed Bunny token). No
  // credentials are ever sent to the browser. The iframe src is set only to
  // the URL returned by the server.
  // -------------------------------------------------------------------------
  function applyMediaConfig(p) {
    if (!p) return;

    try {
      var media   = p.media   || {};
      var content = p.content || {};

      // ---- Founder image (Section E) ----
      var founderImg = $('oc-founder-img');
      if (founderImg && media.founderImage && typeof media.founderImage === 'string') {
        // Load the CDN image; on any error fall back to the static local asset
        // that is already set as the default src in the HTML.
        var cdnSrc = media.founderImage;
        var fallbackSrc = founderImg.src; // the static ../assets/images/founder-aditya.jpg
        var tmpImg = new Image();
        tmpImg.onload = function () { founderImg.src = cdnSrc; };
        tmpImg.onerror = function () { /* keep static fallback — already set */ };
        tmpImg.src = cdnSrc;
      }

      // ---- Section 2 heading / description (admin-configurable) ----
      var whatHeading = document.querySelector('[data-phase39-heading="section2"]') || $('what-title');
      if (whatHeading && content.section2Heading) {
        // textContent prevents XSS — no innerHTML with admin-supplied data
        whatHeading.textContent = content.section2Heading;
      }

      var whatDesc = $('oc-what-desc');
      if (whatDesc && content.section2Description) {
        whatDesc.textContent = content.section2Description;
      }

      // ---- Section 2 intro video ----
      var videoWrap = $('oc-intro-video-wrap');
      var videoContainer = $('oc-intro-video-container');
      var videoEmpty = $('oc-video-empty');
      var videoCaptionSub = $('oc-video-caption-sub');

      if (videoWrap && videoContainer && media.introVideo && media.introVideo.embedUrl) {
        var embedUrl = media.introVideo.embedUrl;

        // Verify this looks like a Bunny embed URL before injecting as iframe src.
        // This is a defence-in-depth check; the real security is that the URL
        // was generated server-side and signed.
        if (typeof embedUrl === 'string' && /^https:\/\/(iframe\.mediadelivery\.net|bunnycdn\.com)\//.test(embedUrl)) {
          videoContainer.innerHTML = ''; // clear any previous
          var iframe = document.createElement('iframe');
          iframe.src = withAutoplayOff(embedUrl);
          // autoplay intentionally left OUT of `allow` — without this
          // permission grant the browser blocks the iframe from
          // autoplaying on page load.
          iframe.setAttribute('allow', 'accelerometer; gyroscope; encrypted-media; picture-in-picture;');
          iframe.setAttribute('allowfullscreen', 'true');
          iframe.setAttribute('loading', 'lazy');
          iframe.setAttribute('title', '1% Club intro video');
          // Responsive sizing
          iframe.style.width  = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          iframe.style.display = 'block';
          videoContainer.appendChild(iframe);
          videoWrap.hidden = false;

          // A real video is live: hide the static placeholder player and
          // drop its "ask the owner to add one" caption in favour of a
          // neutral description, since the wrap/placeholder are mutually
          // exclusive (see the HTML comment above #oc-intro-video-wrap).
          if (videoEmpty) videoEmpty.hidden = true;
          if (videoCaptionSub) videoCaptionSub.textContent = 'Watch this short introduction to the 1% Club.';
        }
      }
      // If no video configured: videoWrap stays hidden and #oc-video-empty
      // (visible by default in the HTML) keeps showing the placeholder
      // player with its default caption — graceful fallback, unchanged.

    } catch (e) {
      // Media config is optional. Any error must NEVER break the purchase flow.
      // Silently ignore and let the static HTML stand.
    }
  }

  // Load plan from backend
  // -------------------------------------------------------------------------
  function load() {
    showView('loading');
    setGridState('Loading courses\u2026');

    // Uses Api.get() so CONFIG.API_BASE_URL is always respected.
    // Api.get() unwraps the success envelope and returns data directly.
    // On error it throws an ApiError with .status and .message set by the backend.
    Api.get('/memberships/' + PLAN_SLUG)
      .then(function (data) {
        plan = data;
        selectionLimit = plan.selectionLimit; // server-authoritative; never hardcoded

        // Phase 39: apply dynamic media/content config (founder image, intro video,
        // section 2 text). Never fails the page if optional media is absent.
        applyMediaConfig(plan);

        if (!plan.courses || plan.courses.length === 0) {
          showView('error');
          var errTitle2 = $('oc-error-title');
          var errMsg2   = $('oc-error-msg');
          if (errTitle2) errTitle2.textContent = 'No courses available';
          if (errMsg2)   errMsg2.textContent   = 'The 1% Club membership is not currently configured with any courses. Please contact support or check back later.';
          return;
        }

        updatePageMeta();

        var wrap = $('oc-courses');
        if (wrap) {
          wrap.innerHTML = '';
          plan.courses.forEach(function (c) {
            wrap.appendChild(buildCard(c));
          });
        }
        selectedIds = [];
        selectionComplete = false;
        refreshSelectionUI();
        showView('selection');
      })
      .catch(function (err) {
        // ApiError carries .status (HTTP code) and .message (backend message).
        // Surface the backend's own message for business-rule failures
        // (404 = not found, 409 = INACTIVE plan, 410 = expired) so the user
        // sees "Membership unavailable" rather than a generic network message.
        var status  = (err && err.status) || 0;
        var message = (err && err.message) || '';
        var isUnavailable = status === 404 || status === 409 || status === 410;
        showView('error');
        var errTitle = $('oc-error-title');
        var errMsg   = $('oc-error-msg');
        if (errTitle) errTitle.textContent = isUnavailable ? 'Membership unavailable' : 'Could not load membership';
        if (errMsg) {
          errMsg.textContent = isUnavailable && message
            ? message
            : (status >= 500
                ? 'We\u2019re having trouble loading the 1% Club right now. Please try again shortly.'
                : 'We couldn\u2019t load the 1% Club details. Please check your connection and try again.');
        }
        // Only show retry for network/server errors, not for business-rule blocks
        var retryBtn = $('oc-error-retry');
        if (retryBtn) retryBtn.hidden = isUnavailable;
      });
  }

  // -------------------------------------------------------------------------
  // REVIEW VIEW: build summary from current selection
  // -------------------------------------------------------------------------
  function buildReview() {
    var reviewCourses = $('oc-review-courses');
    if (reviewCourses) {
      reviewCourses.innerHTML = '';
      var courseMap = {};
      (plan.courses || []).forEach(function (c) { courseMap[c.id] = c; });
      selectedIds.forEach(function (id) {
        var c = courseMap[id];
        if (!c) return;
        var li = el('li', 'oc-review-course');

        var thumb = el('div', 'oc-review-thumb');
        if (c.thumbnail) {
          var img = document.createElement('img');
          img.src = c.thumbnail;
          img.alt = '';
          img.loading = 'lazy';
          img.addEventListener('error', function () {
            img.remove();
            var initials = String(c.title || '').split(/\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase();
            thumb.appendChild(el('div', 'oc-review-thumb-fallback', initials));
          });
          thumb.appendChild(img);
        } else {
          var initials2 = String(c.title || '').split(/\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase();
          thumb.appendChild(el('div', 'oc-review-thumb-fallback', initials2));
        }

        var info = el('div', 'oc-review-course-info');
        info.appendChild(el('span', 'oc-review-check', '\u2713'));
        info.appendChild(el('span', 'oc-review-title', c.title));
        li.appendChild(thumb);
        li.appendChild(info);
        reviewCourses.appendChild(li);
      });
    }

    // Price
    var priceEl = $('oc-review-price');
    if (priceEl) priceEl.textContent = money(plan.price, plan.currency);

    var comparePriceEl = $('oc-review-compare-price');
    if (comparePriceEl) {
      if (plan.compareAtPrice && plan.compareAtPrice > plan.price) {
        comparePriceEl.textContent = money(plan.compareAtPrice, plan.currency);
        comparePriceEl.hidden = false;
      } else {
        comparePriceEl.hidden = true;
      }
    }

    var selInfoEl = $('oc-review-sel-info');
    if (selInfoEl) {
      selInfoEl.textContent = selectionLimit + ' of ' + plan.eligibleCourseCount + ' courses selected';
    }

    // Plan name in summary
    var planNameEl = document.querySelector('[data-oc-plan-name]');
    if (planNameEl) planNameEl.textContent = plan.name;

    // Reset payment error
    setReviewError(null);
    hideReviewSpinner();
  }

  // -------------------------------------------------------------------------
  // Review error / spinner helpers
  // -------------------------------------------------------------------------
  function setReviewError(msg) {
    var errEl = $('oc-review-error');
    if (!errEl) return;
    if (msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    } else {
      errEl.hidden = true;
    }
  }

  function showReviewSpinner() {
    var btn = $('oc-review-proceed');
    if (!btn) return;
    btn.disabled = true;
    var spinner = btn.querySelector('.oc-btn-spinner');
    var label   = btn.querySelector('.oc-btn-label');
    if (spinner) spinner.hidden = false;
    if (label)   label.textContent = 'Creating order\u2026';
  }

  function hideReviewSpinner() {
    var btn = $('oc-review-proceed');
    if (!btn) return;
    btn.disabled = false;
    var spinner = btn.querySelector('.oc-btn-spinner');
    var label   = btn.querySelector('.oc-btn-label');
    if (spinner) spinner.hidden = true;
    if (label)   label.textContent = 'Continue to Checkout';
  }

  // -------------------------------------------------------------------------
  // Enter REVIEW: auth check → existing-member check → build review
  // -------------------------------------------------------------------------
  function enterReview() {
    if (!selectionComplete) return;

    // Step 1: Trigger auth check. Auth.requireAuth redirects to login if not
    // authenticated, preserving this page URL in ?next= so the student returns.
    if (typeof Auth === 'undefined' || !Auth.requireAuth) {
      var loginUrl = 'login.html?next=' + encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = loginUrl;
      return;
    }

    // Show a brief loading state while we auth + check membership
    showView('loading');

    Auth.requireAuth().then(function () {
      // Step 2: Authenticated. Check if already an active member.
      return checkExistingMembership();
    }).then(function (isMember) {
      if (isMember) {
        // Show the existing member view — do not allow double purchase
        showView('member');
        SmoothScroll.scrollTo(0);
        return;
      }
      // Not an existing member: build and show review
      buildReview();
      showView('review');
      SmoothScroll.scrollTo(0);
    }).catch(function () {
      // requireAuth redirects on auth failure; if we get here, do manual redirect
      window.location.href = 'login.html';
    });
  }

  // -------------------------------------------------------------------------
  // Create membership order and redirect to checkout.html
  // -------------------------------------------------------------------------
  function proceedToCheckout() {
    if (!plan || !selectionComplete) return;

    showReviewSpinner();
    setReviewError(null);

    // Uses Api.post() so CONFIG.API_BASE_URL is always respected.
    // Api.post() handles CSRF header, credentials, and envelope unwrapping.
    // On success it returns data directly; on failure it throws ApiError with
    // .status, .errorCode, and .message populated from the backend response.
    Api.post('/memberships/' + encodeURIComponent(PLAN_SLUG) + '/orders', { selectedCourseIds: selectedIds })
      .then(function (data) {
        // Success — redirect to checkout with orderId
        var order = data && data.order;
        if (!order || !order.id) {
          setReviewError('Could not create your order. Please try again.');
          hideReviewSpinner();
          return;
        }

        // Redirect to the existing checkout page with orderId
        window.location.href = 'checkout.html?orderId=' + encodeURIComponent(order.id);
      })
      .catch(function (err) {
        var status    = (err && err.status)    || 0;
        var errorCode = (err && err.errorCode) || '';
        var message   = (err && err.message)   || '';

        // Handle auth expiry — Api already attempted one silent refresh
        if (status === 401 || status === 403) {
          if (typeof Auth !== 'undefined' && Auth.handleSessionError) {
            Auth.handleSessionError(err);
          }
          return;
        }

        // Stale configuration — plan changed while page was open
        if (status === 409 || (errorCode && errorCode.indexOf('MEMBERSHIP') === 0)) {
          var msg = message || 'The membership options have changed. Please review your selection.';
          setReviewError(msg);
          hideReviewSpinner();
          // If selection is now invalid, reload the plan and reset
          if (errorCode === 'MEMBERSHIP_INVALID_SELECTION_COUNT' || errorCode === 'MEMBERSHIP_INELIGIBLE_COURSE') {
            setTimeout(function () {
              selectedIds = [];
              selectionComplete = false;
              load();
            }, 2000);
          }
          return;
        }

        var errorMsg = message || 'Could not create your order. Please try again.';
        setReviewError(errorMsg);
        hideReviewSpinner();
      });
  }

  // -------------------------------------------------------------------------
  // Phase 3: Pre-Book Now — creates/resumes the student's pre-booking and
  // hands off to pre-booking.html, which owns the rest of the journey
  // (payment, course selection, remaining balance). This function does not
  // touch `selectedIds`/`selectionComplete` — the direct-purchase flow
  // above is completely untouched by this path.
  // -------------------------------------------------------------------------
  function startPreBooking() {
    if (!plan) return;

    var btn = $('oc-prebook-cta');
    var spinner = btn && btn.querySelector('.oc-btn-spinner');
    var label = btn && btn.querySelector('.oc-btn-label');

    if (typeof Auth === 'undefined' || !Auth.requireAuth) {
      window.location.href = 'login.html?next=' + encodeURIComponent(window.location.pathname + window.location.search);
      return;
    }

    if (btn) { btn.disabled = true; btn.setAttribute('aria-disabled', 'true'); }
    if (spinner) spinner.hidden = false;
    if (label) label.textContent = 'Please wait\u2026';

    function resetBtn() {
      if (btn) { btn.disabled = false; btn.removeAttribute('aria-disabled'); }
      if (spinner) spinner.hidden = true;
      if (label) label.textContent = 'Pre-Book Now';
    }

    Auth.requireAuth().then(function () {
      // Same existing-member guard as the direct-purchase path: a current
      // member has nothing to pre-book.
      return checkExistingMembership();
    }).then(function (isMember) {
      if (isMember) {
        showView('member');
        SmoothScroll.scrollTo(0);
        resetBtn();
        return null;
      }
      // Idempotent: creates a new pre-booking, or resumes the student's
      // existing open one — never a second active booking for repeated
      // clicks/refreshes (spec: "Do not create multiple active
      // pre-bookings").
      return Api.post('/memberships/' + encodeURIComponent(PLAN_SLUG) + '/pre-bookings', {})
        .then(function (data) {
          var order = data && data.order;
          if (!order || !order.id) {
            resetBtn();
            return;
          }
          window.location.href = 'pre-booking.html?orderId=' + encodeURIComponent(order.id) +
            '&slug=' + encodeURIComponent(PLAN_SLUG);
        });
    }).catch(function (err) {
      var status = (err && err.status) || 0;
      if (status === 401 || status === 403) {
        if (typeof Auth !== 'undefined' && Auth.handleSessionError) Auth.handleSessionError(err);
        return;
      }
      resetBtn();
      // Pre-booking became unavailable since the page loaded (disabled or
      // reconfigured mid-visit) — hide the row immediately so the student
      // isn't left with a dead-end button, then re-fetch the plan so
      // updatePreBookRow() reflects the server's current, authoritative
      // state rather than the stale copy already in memory.
      if (status === 409 || status === 404) {
        var row = $('oc-prebook-row');
        if (row) row.hidden = true;
        Api.get('/memberships/' + encodeURIComponent(PLAN_SLUG))
          .then(function (freshPlan) {
            plan = freshPlan;
            updatePreBookRow();
          })
          .catch(function () { /* keep the row hidden; next full load() will reconcile */ });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------
  function wireEvents() {
    // Primary hero CTA
    var cta = $('oc-cta');
    if (cta) {
      cta.addEventListener('click', function () {
        if (!selectionComplete) return;
        enterReview();
      });
    }

    // Section CTA (below course grid)
    var sectCta = $('oc-section-cta');
    if (sectCta) {
      sectCta.addEventListener('click', function () {
        if (!selectionComplete) return;
        enterReview();
      });
    }

    // Sticky bar CTA
    var stickyCta = $('oc-sticky-cta');
    if (stickyCta) {
      stickyCta.addEventListener('click', function () {
        if (!selectionComplete) return;
        enterReview();
      });
    }

    // Phase 3: Pre-Book Now
    var prebookBtn = $('oc-prebook-cta');
    if (prebookBtn) {
      // Pre-Book Now first opens the "How pre-booking works" page (terms +
      // explanation). Its Continue button runs the same create/resume flow
      // (startPreBooking logic) and then goes to pre-booking.html.
      prebookBtn.addEventListener('click', function () {
        window.location.href = 'pre-booking-info.html?slug=' + encodeURIComponent(PLAN_SLUG);
      });
    }

    // Review — Edit Selection button
    var editBtn = $('oc-review-edit');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        showView('selection');
        var chooseSect = $('choose');
        if (chooseSect) SmoothScroll.scrollTo(chooseSect);
      });
    }

    // Review — Proceed to checkout
    var proceedBtn = $('oc-review-proceed');
    if (proceedBtn) {
      proceedBtn.addEventListener('click', proceedToCheckout);
    }

    // Error retry button
    var retryBtn = $('oc-error-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        selectedIds = [];
        selectionComplete = false;
        load();
      });
    }

    // Hero scroll-to-courses link
    var scrollLink = $('oc-scroll-courses');
    if (scrollLink) {
      scrollLink.addEventListener('click', function (e) {
        e.preventDefault();
        var chooseSect = $('choose');
        if (chooseSect) SmoothScroll.scrollTo(chooseSect);
      });
    }

    // Hero "Watch intro" link — scrolls to the intro video section
    var scrollVideoLink = $('oc-scroll-video');
    if (scrollVideoLink) {
      scrollVideoLink.addEventListener('click', function (e) {
        e.preventDefault();
        var videoSect = $('watch-intro');
        if (videoSect) SmoothScroll.scrollTo(videoSect);
      });
    }

    // Show/hide sticky bar based on scroll position (appear after hero)
    var hero = document.querySelector('.oc-hero');
    if (hero && stickyEl) {
      var io = null;
      if (window.IntersectionObserver) {
        io = new IntersectionObserver(function (entries) {
          var heroVisible = entries[0].isIntersecting;
          if (!heroVisible && currentView === 'selection') {
            stickyEl.classList.add('is-visible');
          } else if (heroVisible || currentView !== 'selection') {
            stickyEl.classList.remove('is-visible');
          }
        }, { threshold: 0 });
        io.observe(hero);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Testimonials (Phase 5: shared public Testimonials API)
  //
  // Reads the SAME GET /testimonials endpoint as the Main Testimonials page
  // (assets/js/testimonials.js) — one shared testimonial database, one
  // public API source (see backend/src/services/testimonial.service.js).
  // There is no `section` field on the backend: this page selects its own
  // subset the same way it always did, by filtering the shared list on the
  // existing `program` content field ('1% Club member'), not by querying a
  // separate collection or a hidden section flag.
  //
  // Only quote + name are required to show a testimonial; everything else
  // (role, video) is shown only when present and valid. Nothing is invented
  // and no old hardcoded testimonial is shown while this loads or if it
  // fails — the section hides instead, exactly as it did for an empty seed.
  // -------------------------------------------------------------------------
  var BUNNY_EMBED_HOST_RE = /^https:\/\/(iframe\.mediadelivery\.net|bunnycdn\.com)\//;

  async function renderTestimonials() {
    var proof = $('oc-proof');
    if (!proof) return;

    function hideSection() {
      var section = proof.closest('section');
      if (section) section.hidden = true;
    }

    var items;
    try {
      var data = await Api.get('/testimonials?limit=100');
      if (!data || !Array.isArray(data.items)) throw new Error('malformed');
      items = data.items;
    } catch (e) {
      // Network/API failure: hide the section rather than show nothing
      // useful or fall back to stale hardcoded content.
      hideSection();
      return;
    }

    var member = items.filter(function (t) {
      return t && t.program === '1% Club member' && typeof t.quote === 'string' && t.quote.trim() &&
        typeof t.name === 'string' && t.name.trim();
    }).slice(0, 3); // cap: show at most 3 cards in this section

    if (!member.length) { hideSection(); return; }

    // Markup below intentionally mirrors testimonials.js's .tm-card exactly
    // (same classes: tm-card / tm-video-embed / tm-video-placeholder /
    // tm-quote / tm-author / tm-avatar / tm-who / tm-name / tm-meta) so this
    // section looks identical to the testimonials page instead of falling
    // back to plain, unstyled <figure>/<blockquote> markup. Built with
    // DOM methods + textContent (not innerHTML) to stay safely escaped,
    // same as the rest of this file's DOM-building code.
    member.forEach(function (t) {
      var card = el('article', 'tm-card');

      // VIDEO testimonials: embed the short-lived signed Bunny URL the
      // backend issued (testimonial.service.js#publicVideoPlaybackFor),
      // never a raw video id. Same host safelist as the Section 2 intro
      // video above — defence in depth on top of the server-side signing.
      if (t.type === 'VIDEO' && t.video && typeof t.video.embedUrl === 'string' && BUNNY_EMBED_HOST_RE.test(t.video.embedUrl)) {
        var videoBox = el('div', 'tm-video-embed');
        var placeholder = el('div', 'tm-video-placeholder');
        placeholder.setAttribute('aria-hidden', 'true');
        var playIcon = el('span', 'tm-video-play', '\u25B6');
        placeholder.appendChild(playIcon);
        videoBox.appendChild(placeholder);

        var iframe = document.createElement('iframe');
        iframe.src = withAutoplayOff(t.video.embedUrl);
        // autoplay intentionally left OUT of `allow` — see note above.
        iframe.setAttribute('allow', 'accelerometer; gyroscope; encrypted-media; picture-in-picture;');
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('title', 'Video testimonial from ' + t.name);
        // Same fix as testimonials.js: hide the placeholder outright once
        // loaded (belt-and-suspenders alongside the CSS :has() rule) so it
        // can never sit on top of the iframe and swallow taps meant for the
        // player's own play/pause/mute controls.
        iframe.addEventListener('load', function () {
          iframe.classList.add('is-loaded');
          placeholder.style.display = 'none';
        });
        videoBox.appendChild(iframe);
        card.appendChild(videoBox);
      }

      var quoteBlock = el('blockquote', 'tm-quote');
      var quoteP = el('p', '', t.quote);
      quoteBlock.appendChild(quoteP);
      card.appendChild(quoteBlock);

      var footer = el('footer', 'tm-author');

      var avatar = el('span', 'tm-avatar tm-avatar-text', t.name.charAt(0).toUpperCase());
      avatar.setAttribute('aria-hidden', 'true');
      footer.appendChild(avatar);

      var who = el('span', 'tm-who');
      who.appendChild(el('strong', 'tm-name', t.name));
      if (t.role) who.appendChild(el('span', 'tm-meta', t.role));
      if (t.program) who.appendChild(el('span', 'tm-program', t.program));
      footer.appendChild(who);

      card.appendChild(footer);
      proof.appendChild(card);
    });
  }

  // -------------------------------------------------------------------------
  // Initialise
  // -------------------------------------------------------------------------
  wireEvents();
  renderTestimonials();
  load();
})();