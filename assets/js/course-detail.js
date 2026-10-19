/**
 * Course Detail page controller.
 *
 * Reads `?slug=` from the URL (the site's clean-URL convention given a
 * static file server — see serve-static.js and the super-admin
 * `course-form.html?id=` precedent). Fetches:
 *   1. GET /courses/:slug         -> public course detail (spec 11-12)
 *   2. GET /courses/:slug/curriculum -> public curriculum preview (spec 13)
 *
 * IMPORTANT (spec 14-15, 45): this file NEVER requests or renders anything
 * from the Phase 8 video/Bunny authorization surface. The curriculum
 * response contains only title/order/type/duration/isFreePreview per
 * lesson — there is no protected video URL to accidentally expose because
 * the backend never sends one to this endpoint.
 *
 * A missing/invalid/unpublished slug all resolve to the SAME "Course not
 * found" state (spec 23, 49) — this file does not attempt to distinguish
 * them, matching the backend's deliberate non-disclosure.
 */

(function initCourseDetailPage() {
  const loadingEl = document.getElementById('loading-state');
  const errorEl = document.getElementById('error-state');
  const contentEl = document.getElementById('course-content');

  function getSlug() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('slug') || '').trim();
  }

  function showError(title, message) {
    loadingEl.hidden = true;
    contentEl.hidden = true;
    errorEl.hidden = false;
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
  }

  function setSeo(course) {
    const title = `${course.title} — The Knight Club`;
    const description = course.shortDescription || `Learn ${course.title} on The Knight Club.`;
    // window.location.origin (not a hardcoded/placeholder domain) so the
    // canonical/OG URL is correct on whichever host this actually deploys
    // to (spec 20-21, 41) — config.js only defines the API origin, not the
    // site's own, and inventing one here would risk silently pointing SEO
    // metadata at the wrong domain.
    const canonicalUrl = `${window.location.origin}/pages/course.html?slug=${encodeURIComponent(course.slug)}`;

    document.title = title;
    document.getElementById('page-title').textContent = title;
    document.getElementById('page-description').setAttribute('content', description);
    document.getElementById('page-canonical').setAttribute('href', canonicalUrl);

    document.getElementById('og-title').setAttribute('content', title);
    document.getElementById('og-description').setAttribute('content', description);
    document.getElementById('og-url').setAttribute('content', canonicalUrl);
    const ogImage = document.getElementById('og-image');
    if (course.thumbnail) ogImage.setAttribute('content', course.thumbnail);
    else ogImage.remove(); // no fake/placeholder image (spec 21)

    setStructuredData(course, canonicalUrl);
  }

  /**
   * JSON-LD Course schema (spec 22). Only properties for which real data
   * exists are included — no rating/review/enrollment counts are ever
   * fabricated (spec 22, 50): this app has no review system, so
   * `aggregateRating`/`review` are simply never emitted, not filled with
   * placeholder numbers.
   */
  function setStructuredData(course, canonicalUrl) {
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: course.title,
      description: course.shortDescription || course.description || undefined,
      url: canonicalUrl,
      ...(course.thumbnail ? { image: course.thumbnail } : {}),
      ...(course.instructor
        ? { provider: { '@type': 'Organization', name: 'The Knight Club' }, author: { '@type': 'Person', name: course.instructor.name } }
        : { provider: { '@type': 'Organization', name: 'The Knight Club' } }),
      ...(course.pricing
        ? {
            offers: {
              '@type': 'Offer',
              price: (course.pricing.salePrice / 100).toFixed(2),
              priceCurrency: course.pricing.currency,
              availability: 'https://schema.org/InStock',
              url: canonicalUrl,
            },
          }
        : {}),
    };
    // Escape "</" so a course title/description containing a literal
    // "</script>" cannot break out of this inline JSON-LD block (textContent
    // already prevents HTML injection into the page; this additionally
    // guards the script tag's own boundary, since a raw "</script" inside
    // the JSON text would still terminate the tag early in the parser).
    document.getElementById('course-structured-data').textContent = JSON.stringify(data).replace(/<\//g, '<\\/');
  }

  function renderMetaTop(course) {
    const wrap = document.getElementById('detail-meta-top');
    const level = Format.level(course.metadata && course.metadata.level);
    const badges = [];
    if (course.category) badges.push(`<span class="badge">${Format.escapeHtml(course.category.name)}</span>`);
    if (level) badges.push(`<span class="badge badge-muted">${Format.escapeHtml(level)}</span>`);
    wrap.innerHTML = badges.length ? `<div class="course-card-meta" style="margin-bottom: var(--space-4);">${badges.join('')}</div>` : '';
  }

  function renderMetaRow(course) {
    const row = document.getElementById('course-meta-row');
    const parts = [];
    if (course.instructor) parts.push(`by <strong style="color:var(--color-text);">${Format.escapeHtml(course.instructor.name)}</strong>`);
    const duration = Format.durationFromMinutes(course.metadata && course.metadata.durationMinutes);
    if (duration) parts.push(duration);
    if (course.metadata && course.metadata.language) parts.push(course.metadata.language.toUpperCase());
    row.innerHTML = parts.map((p, i) => (i === 0 ? p : `<span class="dot">•</span>${p}`)).join(' ');
  }

  function renderOutcomesAndRequirements(course) {
    const outcomes = (course.metadata && course.metadata.learningOutcomes) || [];
    const requirements = (course.metadata && course.metadata.requirements) || [];
    const tags = (course.metadata && course.metadata.tags) || [];

    if (outcomes.length) {
      document.getElementById('outcomes-block').hidden = false;
      document.getElementById('outcomes-list').innerHTML = outcomes
        .map((o) => `<li>${Format.escapeHtml(o)}</li>`)
        .join('');
    }
    if (requirements.length) {
      document.getElementById('requirements-block').hidden = false;
      document.getElementById('requirements-list').innerHTML = requirements
        .map((r) => `<li>${Format.escapeHtml(r)}</li>`)
        .join('');
    }
    if (tags.length) {
      document.getElementById('tags-block').hidden = false;
      document.getElementById('tags-row').innerHTML = tags
        .map((t) => `<span class="badge badge-muted">${Format.escapeHtml(t)}</span>`)
        .join('');
    }
  }

  function renderBuyCard(course) {
    const original = Format.originalPrice(course.pricing);
    document.getElementById('buy-price').textContent = Format.price(course.pricing);
    const originalEl = document.getElementById('buy-original');
    if (original) {
      originalEl.hidden = false;
      originalEl.textContent = original;
    }
    if (course.thumbnail) {
      const wrap = document.getElementById('buy-thumb-wrap');
      wrap.hidden = false;
      document.getElementById('buy-thumb').src = course.thumbnail;
      document.getElementById('buy-thumb').alt = course.title;
    }
    wireEnrollButton(course);
    // Phase 29: Add to Cart button. Wired after the enroll button so both
    // CTAs are handled in one place. The Add to Cart button is only shown
    // for paid, available courses where the student is not already enrolled.
    wireAddToCartButton(course);
  }

  /**
   * Phase 29: Wires the Add to Cart button on the course detail buy card.
   *
   * BUTTON STATES:
   *   hidden         — free course, or student is already enrolled (handled
   *                    by wireEnrollButton showing "Start Learning" instead)
   *   ADD TO CART    — not in cart, not owned
   *   IN CART        — already in cart (shows go-to-cart link too)
   *   LOADING        — during the add request
   *   ERROR          — recoverable: button returns to previous state
   *
   * Cart.js must be loaded for this to work. If it isn't (e.g. older page
   * cache), the button remains hidden and the enroll button still works.
   *
   * NOTE: Coupon codes are NOT applied on the Course Detail page. Coupon
   * application happens exclusively on the Checkout page (Phase 34).
   */
  function wireAddToCartButton(course) {
    const btn = document.getElementById('add-to-cart-btn');
    const goToCartLink = document.getElementById('go-to-cart-link');
    const alertEl = document.getElementById('buy-alert');

    // Guard: Cart module must be available, and course must be a paid,
    // available course (free courses have no cart CTA).
    if (!btn || typeof Cart === 'undefined') return;
    if (!course.pricing || course.pricing.isFree) return;

    // Show the button (it's hidden by default in HTML).
    btn.hidden = false;

    let _inCart = false;

    function setInCartState(inCart) {
      _inCart = inCart;
      const labelEl = btn.querySelector('.label');
      if (inCart) {
        if (labelEl) labelEl.textContent = 'In Cart';
        btn.disabled = true; // already in cart — no re-add
        if (goToCartLink) goToCartLink.hidden = false;
      } else {
        if (labelEl) labelEl.textContent = 'Add to Cart';
        btn.disabled = false;
        if (goToCartLink) goToCartLink.hidden = true;
      }
    }

    // Check if course is already in cart (non-blocking; button is usable
    // immediately and state updates when the check resolves).
    Cart.getCart().then((cartData) => {
      if (!cartData || !cartData.items) return;
      const alreadyInCart = cartData.items.some((item) => item.courseId === course.id);
      if (alreadyInCart) setInCartState(true);
    }).catch(() => { /* silent — button stays in ADD state */ });

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;

      // Require authentication (redirects to login with return path if not signed in).
      try {
        await Auth.requireAuth();
      } catch {
        return; // requireAuth handles the redirect
      }

      const labelEl = btn.querySelector('.label');
      const prevLabel = labelEl ? labelEl.textContent : 'Add to Cart';
      btn.disabled = true;
      if (labelEl) labelEl.textContent = 'Adding…';
      Forms.hideAlert(alertEl);

      try {
        const { alreadyInCart } = await Cart.addToCart(course.id);
        setInCartState(true);
        if (!alreadyInCart) {
          // Show a brief success toast; don't block the page.
          if (typeof StudentUI !== 'undefined' && StudentUI.toast) {
            StudentUI.toast('Added to cart!', 'success');
          }
        }
      } catch (err) {
        // Specific error codes from the backend:
        //   ALREADY_OWNED / 409  → student already has the course
        //   400                  → course unavailable
        //   401                  → not authenticated (should not reach here)
        if (err && err.status === 409) {
          // Already purchased → hide Add to Cart, show Start Learning.
          btn.hidden = true;
          if (goToCartLink) goToCartLink.hidden = true;
          const startLink = document.getElementById('start-learning-link');
          if (startLink) startLink.hidden = false;
        } else if (err && err.status === 401) {
          Auth.handleSessionError(err);
        } else {
          // Recoverable: restore button state.
          btn.disabled = false;
          if (labelEl) labelEl.textContent = prevLabel;
          Forms.showAlert(alertEl, (err && err.message) || 'Could not add to cart. Please try again.', 'error');
        }
      }
    });
  }


  /**
   * Wires the "Enroll now" button to the Phase 15 payment flow. Course
   * access itself is granted server-side by Phase 16 the moment the
   * webhook confirms CAPTURED — this handler never declares "enrolled" on
   * its own; it only reflects what the backend has already decided (spec
   * Step 52, "CRITICAL ARCHITECTURE RULE").
   */
  function wireEnrollButton(course) {
    const btn = document.getElementById('enroll-btn');
    const alertEl = document.getElementById('buy-alert');

    // A free course has nothing for Razorpay to charge (see
    // A free course has nothing for Razorpay to charge (see
    // payment.service.js#loadPurchasableCourse) — there is no "get it for
    // free" action to offer here yet either. Keep the button visible (spec
    // 21: no invented affordances) but explain rather than let it fail
    // silently. Uses the backend's own `pricing.isFree` flag rather than
    // re-deriving "free" from salePrice here, so this never drifts out of
    // sync with whatever the backend actually treats as free.
    if (course.pricing && course.pricing.isFree) {
      btn.disabled = true;
      btn.querySelector('.label').textContent = 'Not available yet';
      return;
    }

    btn.addEventListener('click', async () => {
      Forms.hideAlert(alertEl);
      const user = await Auth.requireAuth(); // redirects to login (with return path) if signed out
      Forms.setLoading(btn, true, 'Starting checkout…');

      await Payments.purchaseCourse({
        courseId: course.id,
        // NOTE (Phase 34): Coupon codes are no longer applied on the Course
        // Detail page. Coupons are applied exclusively at the Checkout stage
        // (cart → checkout → apply coupon). This legacy single-course enroll
        // path does not pass a couponCode.
        prefill: { fullName: user.fullName, mobile: user.mobile },
        onVerified() {
          Forms.setLoading(btn, false);
          // PHASE 16 FIX (Issue #2): this message previously said "Payment
          // confirmed — you now have access to this course", but onVerified
          // fires the moment POST /payments/verify succeeds, which only
          // proves the Checkout callback's signature is valid — that
          // advances the Payment to AUTHORIZED (see
          // payment.service.js#verifyCheckoutCallback), never CAPTURED.
          // CAPTURED, and the Enrollment it produces, are only reached
          // later, asynchronously, via the Razorpay webhook (spec Step 46).
          // So at this exact moment access is NOT yet actually confirmed —
          // the copy must not claim it is. It still says the payment step
          // succeeded (true) and sets honest expectations for the brief
          // wait, rather than a false "you now have access".
          Forms.showAlert(
            alertEl,
            'Payment received — confirming your access, this only takes a moment…',
            'success'
          );
          // The webhook creates the Enrollment the moment Razorpay confirms
          // CAPTURED (server-side, asynchronous). This goes to the Learning
          // Page rather than flipping any local "enrolled" state; learn.js
          // re-checks real access from the server on load and shows its own
          // brief loading/retry state if the webhook is still a moment
          // behind — never a false unlock from this page.
          setTimeout(() => {
            window.location.href = `learn.html?courseId=${encodeURIComponent(course.id)}`;
          }, 1200);
        },
        onFailed(message) {
          Forms.setLoading(btn, false);
          Forms.showAlert(alertEl, message || 'Payment failed. Please try again.', 'error');
        },
        onCancelled() {
          Forms.setLoading(btn, false);
          Forms.showAlert(alertEl, 'Checkout was closed before completing payment.', 'info');
        },
        onError(message) {
          Forms.setLoading(btn, false);
          Forms.showAlert(alertEl, message || 'Could not start checkout. Please try again.', 'error');
        },
      });
    });
  }

  function lessonIcon() {
    // Small neutral dot — deliberately not a play icon, since a visitor has
    // no protected playback access from this page (spec 14-15).
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="lesson-type-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor"/>
    </svg>`;
  }

  async function renderCurriculum(slug, courseId) {
    const block = document.getElementById('curriculum-block');
    const listEl = document.getElementById('curriculum-list');
    const summaryEl = document.getElementById('curriculum-summary');
    try {
      const data = await Catalog.getCurriculum(slug);
      const modules = data.modules || [];
      if (!modules.length) return; // keep block hidden — nothing to preview yet

      const totalLessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);
      block.hidden = false;
      summaryEl.textContent = `${modules.length} module${modules.length === 1 ? '' : 's'} · ${totalLessons} lesson${totalLessons === 1 ? '' : 's'}`;

      listEl.innerHTML = modules
        .map((m, idx) => {
          const lessonsHtml = m.lessons
            .map((l) => {
              // Free-preview lessons link to the real, authenticated Learning
              // Page (Phase 13) so "Preview" is an actual working link, not
              // decoration — but only Auth.requireAuth() there decides
              // whether the visitor may actually watch it.
              const previewHref = l.isFreePreview && courseId
                ? `learn.html?courseId=${encodeURIComponent(courseId)}&lessonId=${encodeURIComponent(l.id)}`
                : null;
              const titleInner = `${lessonIcon()}<span>${Format.escapeHtml(l.title)}</span>${l.isFreePreview ? '<span class="badge badge-muted">Preview</span>' : ''}`;
              const left = previewHref
                ? `<a class="lesson-left" href="${previewHref}">${titleInner}</a>`
                : `<span class="lesson-left">${titleInner}</span>`;
              return `
              <li>
                ${left}
                <span class="lesson-right">${Format.durationFromSeconds(l.durationSeconds)}</span>
              </li>`;
            })
            .join('');
          return `
            <div class="curriculum-module${idx === 0 ? ' is-open' : ''}">
              <button type="button" class="curriculum-module-header" aria-expanded="${idx === 0}">
                <span>
                  <span class="module-title">${Format.escapeHtml(m.title)}</span>
                  <span class="module-sub"> · ${m.lessons.length} lesson${m.lessons.length === 1 ? '' : 's'}</span>
                </span>
                <svg class="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <ul class="curriculum-lessons">${lessonsHtml || '<li><span class="lesson-left">No lessons published yet.</span></li>'}</ul>
            </div>`;
        })
        .join('');

      listEl.querySelectorAll('.curriculum-module-header').forEach((btn) => {
        btn.addEventListener('click', () => {
          const moduleEl = btn.closest('.curriculum-module');
          const willOpen = !moduleEl.classList.contains('is-open');
          moduleEl.classList.toggle('is-open', willOpen);
          btn.setAttribute('aria-expanded', String(willOpen));
        });
      });
    } catch {
      // Curriculum is a secondary block; if it fails, the rest of the page
      // (already rendered) still stands. No error banner for this alone.
    }
  }

  /**
   * Renders the Related Courses section from the same card DTO the /courses
   * listing uses (spec 24-25). Real backend data only: the block stays
   * hidden — never filled with anything invented — whenever the backend
   * returns no related courses.
   */
  function renderRelatedCourses(relatedCourses) {
    const block = document.getElementById('related-block');
    const listEl = document.getElementById('related-list');
    if (!relatedCourses || !relatedCourses.length) return; // keep hidden

    listEl.innerHTML = relatedCourses
      .map((course) => {
        const href = `course.html?slug=${encodeURIComponent(course.slug)}`;
        const original = Format.originalPrice(course.pricing);
        return `
          <a class="course-card" href="${href}">
            <div class="course-card-thumb">
              ${course.thumbnail
                ? `<img src="${Format.escapeHtml(course.thumbnail)}" alt="" loading="lazy" />`
                : `<div class="thumb-fallback" aria-hidden="true">${Format.escapeHtml((course.title || '?').charAt(0).toUpperCase())}</div>`}
            </div>
            <div class="course-card-body">
              <div class="course-card-meta">
                ${course.category ? `<span class="badge">${Format.escapeHtml(course.category.name)}</span>` : ''}
              </div>
              <h3 class="course-card-title">${Format.escapeHtml(course.title)}</h3>
              ${course.instructor ? `<p class="course-card-instructor">by ${Format.escapeHtml(course.instructor.name)}</p>` : ''}
              <div class="course-card-footer">
                <span>
                  <span class="price-current">${Format.escapeHtml(Format.price(course.pricing))}</span>
                  ${original ? `<span class="price-original">${Format.escapeHtml(original)}</span>` : ''}
                </span>
              </div>
            </div>
          </a>`;
      })
      .join('');
    block.hidden = false;
  }

  async function init() {
    const slug = getSlug();
    if (!slug) {
      showError('Course not found', "This course doesn't exist or is no longer available.");
      return;
    }

    try {
      const data = await Catalog.getCourse(slug);
      const course = data.course;

      loadingEl.hidden = true;
      errorEl.hidden = true;
      contentEl.hidden = false;

      setSeo(course);
      renderMetaTop(course);
      document.getElementById('crumb-title').textContent = course.title;
      document.getElementById('course-title').textContent = course.title;
      document.getElementById('course-short-desc').textContent = course.shortDescription || '';
      renderMetaRow(course);
      document.getElementById('course-description').textContent = course.description || course.shortDescription || '';
      renderOutcomesAndRequirements(course);
      renderBuyCard(course);
      renderRelatedCourses(data.relatedCourses);

      // Curriculum is fetched after the main detail render so the page is
      // useful even if this secondary call is slow (spec 21, 33, 68).
      renderCurriculum(slug, course.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        showError('Course not found', "This course doesn't exist or is no longer available.");
      } else if (err instanceof ApiError && err.isNetworkError) {
        showError("Couldn't load this course", err.message);
      } else {
        showError('Something went wrong', 'Please try again in a moment.');
      }
    }
  }

  init();
})();