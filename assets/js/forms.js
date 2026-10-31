/**
 * Forms — small shared helpers for the auth pages.
 *
 * Client-side validation here exists ONLY to give instant feedback and save a
 * round trip. It is a convenience, never a control: the backend re-validates
 * everything and is the source of truth. The rules below intentionally
 * MIRROR backend/src/utils/normalize.js and validators/auth.validators.js;
 * if they ever drift, the server wins and its message is shown.
 *
 * All text is written with textContent, never innerHTML, so nothing a user
 * types (or the API returns) can be interpreted as markup.
 */

const Forms = (() => {
  // ---- Rules mirrored from the backend ------------------------------------
  const USER_ID_MIN = 4;
  const USER_ID_MAX = 20;
  const USER_ID_REGEX = /^[a-z0-9][a-z0-9_]*$/;
  const MOBILE_REGEX = /^[6-9]\d{9}$/;
  const PASSWORD_MIN = 8;
  const PASSWORD_MAX = 128;
  // Mirrors backend/src/utils/normalize.js EMAIL_REGEX / EMAIL_MAX exactly.
  const EMAIL_MAX = 254;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Same normalization as the backend, so what the user sees matches what is checked. */
  function normalizeUserId(v) {
    return String(v || '').normalize('NFKC').trim().toLowerCase();
  }

  function normalizeMobile(v) {
    let s = String(v || '').normalize('NFKC').trim();
    const hadPlus = s.startsWith('+');
    s = s.replace(/\D/g, '');
    if (hadPlus && s.startsWith('91') && s.length === 12) return s.slice(2);
    if (s.startsWith('0091') && s.length === 14) return s.slice(4);
    if (s.startsWith('91') && s.length === 12) return s.slice(2);
    if (s.startsWith('0') && s.length === 11) return s.slice(1);
    return s;
  }

  function normalizeEmail(v) {
    return String(v || '').normalize('NFKC').trim().toLowerCase();
  }

  /**
   * Escapes text for the rare case a value must go through innerHTML (a
   * status page built from a template string — see verify-email.js /
   * reset-password.js). Every OTHER place in this app sets text via
   * textContent/setFieldError/showAlert and never needs this. Named
   * distinctly so a reviewer immediately sees any call site is the
   * exception, not the rule.
   */
  function escapeForHtml(v) {
    return String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ---- DOM helpers --------------------------------------------------------

  function fieldEl(input) {
    return input.closest('.field');
  }

  function errorEl(input) {
    return fieldEl(input).querySelector('.field-error');
  }

  function setFieldError(input, message) {
    const field = fieldEl(input);
    const err = errorEl(input);
    field.classList.add('has-error');
    input.setAttribute('aria-invalid', 'true');
    err.textContent = message;
  }

  function clearFieldError(input) {
    const field = fieldEl(input);
    field.classList.remove('has-error');
    input.removeAttribute('aria-invalid');
    errorEl(input).textContent = '';
  }

  function clearAllErrors(form) {
    form.querySelectorAll('.input').forEach(clearFieldError);
  }

  /** Shows a banner alert. kind: 'error' | 'success' | 'info'. */
  function showAlert(el, message, kind = 'error') {
    el.className = `alert alert-${kind}`;
    el.textContent = message;
    el.hidden = false;
  }

  function hideAlert(el) {
    el.hidden = true;
    el.textContent = '';
  }

  /** Toggles a submit button's loading state and prevents double submits. */
  function setLoading(button, isLoading, loadingLabel) {
    if (isLoading) {
      button.dataset.label = button.querySelector('.label').textContent;
      button.querySelector('.label').textContent = loadingLabel;
    } else if (button.dataset.label) {
      button.querySelector('.label').textContent = button.dataset.label;
    }
    button.classList.toggle('is-loading', isLoading);
    button.disabled = isLoading;
    button.setAttribute('aria-busy', String(isLoading));
  }

  /** Wires every ".toggle-password" button to reveal/hide its sibling input. */
  function initPasswordToggles(root = document) {
    root.querySelectorAll('.toggle-password').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-pressed', String(show));
      });
    });
  }

  /**
   * Applies an ApiError's per-field errors (422) to the form.
   * Returns the ones it could NOT attach to a visible field, so the caller
   * can show them in the banner instead of silently dropping them.
   */
  function applyServerErrors(form, errors) {
    const unmatched = [];
    let firstInvalid = null;
    for (const { field, message } of errors || []) {
      const input = form.elements[field];
      if (input && input.classList && input.classList.contains('input')) {
        setFieldError(input, message);
        if (!firstInvalid) firstInvalid = input;
      } else {
        unmatched.push(message);
      }
    }
    if (firstInvalid) firstInvalid.focus();
    return unmatched;
  }

  // ---- Shared client-side checks (each returns an error string or '') -----

  const check = {
    userId(v) {
      const n = normalizeUserId(v);
      if (!n) return 'Please provide a valid User ID.';
      if (n.length < USER_ID_MIN || n.length > USER_ID_MAX || !USER_ID_REGEX.test(n)) {
        return `User ID must be ${USER_ID_MIN}-${USER_ID_MAX} characters: letters, numbers or underscore, starting with a letter or number.`;
      }
      return '';
    },
    mobile(v) {
      return MOBILE_REGEX.test(normalizeMobile(v)) ? '' : 'Please provide a valid 10-digit Indian mobile number.';
    },
    email(v) {
      const n = normalizeEmail(v);
      if (!n) return 'Please provide your email address.';
      if (n.length > EMAIL_MAX || !EMAIL_REGEX.test(n)) return 'Please provide a valid email address.';
      return '';
    },
    password(v) {
      if (!v) return 'Please provide a password.';
      if (v.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
      if (v.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
      if (v.trim().length === 0) return 'Password cannot be only spaces.';
      if (new Set(v).size < 2) return 'Password is too simple.';
      return '';
    },
    required(v, label) {
      return String(v || '').trim() ? '' : `Please provide ${label}.`;
    },
  };

  return {
    normalizeUserId,
    normalizeMobile,
    normalizeEmail,
    escapeForHtml,
    check,
    setFieldError,
    clearFieldError,
    clearAllErrors,
    showAlert,
    hideAlert,
    setLoading,
    initPasswordToggles,
    applyServerErrors,
    PASSWORD_MIN,
    PASSWORD_MAX,
    EMAIL_MAX,
  };
})();
