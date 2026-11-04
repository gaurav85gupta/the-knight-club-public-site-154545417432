/**
 * Contact page controller.
 *
 * Client-side checks below exist for instant feedback only. The backend must
 * independently validate, sanitize and rate-limit POST /contact (see the
 * contract in the block comment at the bottom of this file).
 *
 * All user/API text is written with textContent, never innerHTML.
 */
(function () {
  'use strict';

  var LIMITS = { name: 80, email: 254, subject: 120, messageMin: 10, message: 2000 };
  var TYPES = ['general', 'course', 'payment', 'support', 'club', 'other'];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PHONE_RE = /^\d{10}$/;

  var form = document.getElementById('contact-form-el');
  if (!form) return;

  var card = form.closest('.ct-form-card');
  var el = {
    name: form.elements.name, email: form.elements.email, phone: form.elements.phone, type: form.elements.enquiryType,
    subject: form.elements.subject, message: form.elements.message, hp: form.elements.website,
    status: document.getElementById('ct-status'), submit: document.getElementById('ct-submit'),
    count: document.getElementById('ct-count'), success: document.getElementById('ct-success'),
    chip: document.getElementById('ct-course-chip'), chipName: document.getElementById('ct-course-name'),
    chipClear: document.getElementById('ct-course-clear'), again: document.getElementById('ct-again')
  };
  var courseSlug = '';
  var inFlight = false;

  /* ---- helpers ---- */
  function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
  function errEl(input) { return document.getElementById(input.id + '-err'); }
  function fieldOf(input) { return input.closest('.field'); }

  function setError(input, msg) {
    fieldOf(input).classList.add('has-error');
    fieldOf(input).classList.remove('is-valid');
    input.setAttribute('aria-invalid', 'true');
    errEl(input).textContent = msg;
  }
  function clearError(input, markValid) {
    fieldOf(input).classList.remove('has-error');
    fieldOf(input).classList.toggle('is-valid', Boolean(markValid));
    input.removeAttribute('aria-invalid');
    errEl(input).textContent = '';
  }
  function showStatus(msg, html) {
    el.status.textContent = '';
    el.status.appendChild(document.createTextNode(msg));
    if (html) html(el.status);
    el.status.hidden = false;
  }
  function hideStatus() { el.status.hidden = true; el.status.textContent = ''; }

  /* ---- per-field rules (each returns an error string or '') ---- */
  var rules = {
    name: function (v) {
      v = clean(v);
      if (!v) return 'Please enter your full name.';
      if (v.length < 2) return 'Your name looks too short.';
      if (v.length > LIMITS.name) return 'Please keep your name under ' + LIMITS.name + ' characters.';
      return '';
    },
    email: function (v) {
      v = String(v || '').trim();
      if (!v) return 'Please enter your email address.';
      if (v.length > LIMITS.email || !EMAIL_RE.test(v)) return 'Please enter a valid email address, like name@example.com.';
      return '';
    },
    phone: function (v) {
      v = String(v || '').replace(/\D+/g, '');
      if (!v) return 'Please enter your phone number.';
      if (!PHONE_RE.test(v)) return 'Please enter a valid 10 digit phone number.';
      return '';
    },
    type: function (v) { return TYPES.indexOf(v) === -1 ? 'Please choose what your message is about.' : ''; },
    subject: function (v) {
      v = clean(v);
      if (!v) return 'Please add a short subject.';
      if (v.length < 3) return 'Please make the subject a little longer.';
      if (v.length > LIMITS.subject) return 'Please keep the subject under ' + LIMITS.subject + ' characters.';
      return '';
    },
    message: function (v) {
      v = String(v || '').trim();
      if (!v) return 'Please write your message.';
      if (v.length < LIMITS.messageMin) return 'Please add a little more detail (at least ' + LIMITS.messageMin + ' characters).';
      if (v.length > LIMITS.message) return 'Please keep your message under ' + LIMITS.message + ' characters.';
      return '';
    }
  };

  function validateOne(key, markValid) {
    var input = el[key];
    var msg = rules[key](input.value);
    if (msg) setError(input, msg); else clearError(input, markValid);
    return msg;
  }
  function validateAll() {
    var first = null;
    ['name', 'email', 'phone', 'type', 'subject', 'message'].forEach(function (k) {
      if (validateOne(k, false) && !first) first = el[k];
    });
    return first;
  }

  /* ---- live behaviour ---- */
  ['name', 'email', 'phone', 'subject', 'message', 'type'].forEach(function (k) {
    el[k].addEventListener('blur', function () { if (el[k].value !== '' || fieldOf(el[k]).classList.contains('has-error')) validateOne(k, true); });
    el[k].addEventListener(k === 'type' ? 'change' : 'input', function () {
      if (fieldOf(el[k]).classList.contains('has-error')) validateOne(k, false);
    });
  });

  /* ---- phone: digits only, hard-capped at 10 ---- */
  el.phone.addEventListener('input', function () {
    var digits = el.phone.value.replace(/\D+/g, '').slice(0, 10);
    if (digits !== el.phone.value) el.phone.value = digits;
  });
  el.message.addEventListener('input', function () {
    var n = el.message.value.length;
    el.count.textContent = n + ' / ' + LIMITS.message;
    el.count.classList.toggle('is-near', n > LIMITS.message * 0.9);
  });

  /* ---- pre-select from the "How can we help" rows ---- */
  document.querySelectorAll('[data-enquiry]').forEach(function (a) {
    a.addEventListener('click', function () {
      var t = a.getAttribute('data-enquiry');
      if (TYPES.indexOf(t) !== -1) { el.type.value = t; clearError(el.type, false); }
      // hash navigation scrolls; move focus once it settles
      setTimeout(function () { (el.name.value ? el.subject : el.name).focus({ preventScroll: true }); }, 350);
    });
  });

  /* ---- course-aware flow: ?course=<slug> (validated against the public catalog) ---- */
  function setCourse(slug, title) {
    courseSlug = slug;
    el.chipName.textContent = title;
    el.chip.hidden = false;
    if (!el.type.value) el.type.value = 'course';
  }
  el.chipClear.addEventListener('click', function () {
    courseSlug = ''; el.chip.hidden = true; el.chipName.textContent = ''; el.type.focus();
  });
  (function initCourse() {
    var slug = clean(new URLSearchParams(window.location.search).get('course'));
    if (!slug || slug.length > 120 || typeof Catalog === 'undefined') return;
    Catalog.getCourse(slug).then(function (data) {
      var c = data && data.course;
      if (c && c.slug && c.title) setCourse(c.slug, c.title);
    }).catch(function () { /* unknown course: ignore silently, form still works */ });
  })();

  /* ---- signed-in student: prefill name only (server derives identity from the session cookie) ---- */
  if (typeof Auth !== 'undefined') {
    Auth.init().then(function (user) {
      if (user && user.fullName && !el.name.value) el.name.value = user.fullName;
    }).catch(function () {});
  }

  /* ---- submit ---- */
  function setLoading(on) {
    inFlight = on;
    el.submit.disabled = on;
    el.submit.classList.toggle('is-loading', on);
    el.submit.setAttribute('aria-busy', String(on));
    el.submit.querySelector('.label').textContent = on ? 'Sending' : 'Send message';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (inFlight) return;
    hideStatus();

    var firstBad = validateAll();
    if (firstBad) { firstBad.focus(); return; }

    var payload = {
      name: clean(el.name.value),
      email: el.email.value.trim(),
      phone: el.phone.value.replace(/\D+/g, ''),
      enquiryType: el.type.value,
      subject: clean(el.subject.value),
      message: el.message.value.trim(),
      website: el.hp.value // honeypot; real users leave it empty
    };
    if (courseSlug) payload.courseSlug = courseSlug;

    setLoading(true);
    Api.post('/contact', payload).then(function () {
      card.classList.add('is-sent');
      form.hidden = true;
      el.success.hidden = false;
      el.success.focus();
      form.reset();
      clearAll();
      el.count.textContent = '0 / ' + LIMITS.message;
    }).catch(function (err) {
      // Never clear the form on failure.
      if (err && err.isValidation && err.errors && err.errors.length) {
        var map = { name: el.name, email: el.email, phone: el.phone, enquiryType: el.type, subject: el.subject, message: el.message };
        var first = null, other = [];
        err.errors.forEach(function (x) {
          if (map[x.field]) { setError(map[x.field], x.message); if (!first) first = map[x.field]; } else other.push(x.message);
        });
        if (other.length) showStatus(other.join(' '));
        if (first) first.focus();
        return;
      }
      if (err && err.isRateLimited) return showStatus('You have sent several messages in a short time. Please wait a few minutes and try again.');
      if (err && err.isNetworkError) return showStatus('We could not reach the server. Check your connection and press Send message to try again.');
      showStatus('Something went wrong and your message was not sent. Please try again, or reach the team by ', function (box) {
        var a = document.createElement('a'); a.href = '#contact-methods'; a.textContent = 'email, WhatsApp or phone'; box.appendChild(a); box.appendChild(document.createTextNode('.'));
      });
    }).then(function () { setLoading(false); });
  });

  function clearAll() { ['name', 'email', 'phone', 'type', 'subject', 'message'].forEach(function (k) { clearError(el[k], false); }); }

  el.again.addEventListener('click', function () {
    card.classList.remove('is-sent');
    el.success.hidden = true;
    form.hidden = false;
    hideStatus();
    if (typeof Auth !== 'undefined') Auth.init().then(function (u) { if (u && u.fullName) el.name.value = u.fullName; }).catch(function () {});
    (el.name.value ? el.type : el.name).focus();
  });
})();

/* ===========================================================================
 * BACKEND CONTRACT  —  POST {API_BASE_URL}/contact   (public, no auth needed)
 *
 * Request JSON:
 *   name         string 2-80        required
 *   email        string <=254       required, valid email
 *   enquiryType  general|course|payment|support|club|other   required
 *   subject      string 3-120       required
 *   message      string 10-2000     required
 *   courseSlug   string <=120       optional; server must resolve it against
 *                                   PUBLISHED+PUBLIC courses, else ignore it
 *   website      string             honeypot; if non-empty, return the normal
 *                                   success response and store/send nothing
 *
 * Response: the standard envelope. 201 { success:true, message, data:{} } ;
 * 422 with errors:[{field,message}] ; 429 when rate limited.
 * The server must trim/normalize, strip control characters, escape on output
 * (admin views AND any email body), cap the body size, and never return
 * stack traces or internal details. Identity, if the visitor is signed in,
 * is taken from the session cookie — never from the request body.
 * =========================================================================== */
