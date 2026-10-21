/**
 * API client.
 *
 * Wraps fetch() against CONFIG.API_BASE_URL and unwraps the backend's
 * standard envelope:
 *
 *   success: { success: true,  message, data }
 *   failure: { success: false, message, errorCode, requestId?, errors? }
 *
 * WHAT THIS FILE IS RESPONSIBLE FOR (and why)
 * -------------------------------------------
 * 1. CSRF marker. The backend rejects every state-changing request that
 *    lacks `X-Requested-With: XMLHttpRequest` (see backend/src/middleware/
 *    csrf.js). It is sent on every non-GET request, here and nowhere else,
 *    so no page can forget it.
 *
 * 2. Credentials. Authentication lives in HttpOnly cookies that JavaScript
 *    cannot read, so every request uses `credentials: 'include'`. This file
 *    never sees, stores or logs a token — there is none to see.
 *
 * 3. Structured errors. Failures throw an `ApiError` that keeps the HTTP
 *    status, the machine-readable `errorCode`, and the per-field validation
 *    `errors` array, so the UI can show "User ID already exists" beside the
 *    right input instead of a generic banner.
 *
 * 4. Silent session refresh. The access cookie is short-lived (15 min). When
 *    a request comes back 401 the client makes ONE attempt to refresh the
 *    session and retries the original request once. Concurrent 401s share a
 *    single in-flight refresh (see `refreshOnce`) so two calls — or a burst of
 *    them — never trigger competing rotations of the refresh token.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - No Authorization header, no token in localStorage/sessionStorage.
 * - No refresh attempt for the auth endpoints themselves (login/register/
 *   refresh/logout): a 401 from /auth/login means "wrong password", not
 *   "session expired", and retrying it would be wrong.
 */

class ApiError extends Error {
  /**
   * @param {string} message      safe, user-displayable message from the API
   * @param {object} info
   * @param {number} info.status     HTTP status (0 = network failure/timeout)
   * @param {string} [info.errorCode]
   * @param {Array<{field:string,message:string}>} [info.errors]
   * @param {string} [info.requestId]
   */
  constructor(message, { status = 0, errorCode = 'UNKNOWN', errors = [], requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.errors = errors;
    this.requestId = requestId;
  }

  get isNetworkError() {
    return this.status === 0;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  get isRateLimited() {
    return this.status === 429;
  }
  get isValidation() {
    return this.status === 422;
  }
}

const Api = (() => {
  const REQUEST_TIMEOUT_MS = 15000;

  // Endpoints whose 401 must NEVER trigger a refresh-and-retry.
  const NO_REFRESH_PATHS = new Set([
    '/auth/login',
    '/auth/register',
    '/auth/refresh',
    '/auth/logout',
  ]);

  let refreshInFlight = null;

  /** Performs one raw HTTP call and returns a normalized result. */
  async function send(path, { method = 'GET', body, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const finalHeaders = { Accept: 'application/json', ...headers };
    if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
    // CSRF marker: required by the backend on every state-changing request.
    if (method !== 'GET' && method !== 'HEAD') finalHeaders['X-Requested-With'] = 'XMLHttpRequest';

    let res;
    try {
      res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
        method,
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = err && err.name === 'AbortError';
      throw new ApiError(
        timedOut
          ? 'The request took too long. Please check your connection and try again.'
          : 'Unable to reach the server. Please check your connection and try again.',
        { status: 0, errorCode: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' }
      );
    } finally {
      clearTimeout(timer);
    }

    const payload = await res.json().catch(() => null);

    if (!res.ok || !payload || payload.success === false) {
      throw new ApiError(
        (payload && payload.message) || `Request failed (${res.status}).`,
        {
          status: res.status,
          errorCode: (payload && payload.errorCode) || 'UNKNOWN',
          errors: (payload && Array.isArray(payload.errors) && payload.errors) || [],
          requestId: payload && payload.requestId,
        }
      );
    }

    return payload.data;
  }

  /**
   * Refreshes the session. All concurrent callers share ONE request:
   * the backend rotates the refresh token on every call, so two parallel
   * refreshes with the same cookie would make the second one a "reuse".
   * @returns {Promise<object|null>} the refreshed payload, or null if the
   *          session could not be refreshed (i.e. the user is logged out).
   */
  function refreshOnce() {
    if (!refreshInFlight) {
      refreshInFlight = send('/auth/refresh', { method: 'POST' })
        .catch(() => null)
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return refreshInFlight;
  }

  async function request(path, options = {}) {
    try {
      return await send(path, options);
    } catch (err) {
      const canRefresh =
        err instanceof ApiError && err.status === 401 && !NO_REFRESH_PATHS.has(path) && !options._retried;
      if (!canRefresh) throw err;

      const refreshed = await refreshOnce();
      if (!refreshed) throw err; // genuinely logged out: surface the original 401
      return request(path, { ...options, _retried: true });
    }
  }

  /**
   * Best-effort write for page-unload moments (`pagehide`, tab close).
   *
   * WHY NOT navigator.sendBeacon
   * sendBeacon can only send POST and cannot set custom headers. This API
   * only accepts PATCH for progress writes, and the CSRF middleware
   * requires `X-Requested-With: XMLHttpRequest` on every state-changing
   * request (see backend/src/middleware/csrf.js). A beacon would 404 (no
   * POST route) and, even with a route, be rejected with 403 (no marker
   * header). `fetch(..., { keepalive: true })` supports any method and any
   * header AND is allowed to outlive the page, so it is the correct tool.
   *
   * CONTRACT
   * - Fire-and-forget: returns nothing, never throws, never awaits a reply.
   * - No refresh/retry: at unload time there is no page left to retry from;
   *   the next normal page load reconciles with the server.
   * - keepalive request bodies are capped by browsers (~64 KB total in
   *   flight); progress payloads are a few bytes.
   *
   * @param {string} path   API path, e.g. '/students/courses/.../progress'
   * @param {object} body   JSON body
   * @param {string} [method='PATCH']
   */
  function sendOnUnload(path, body, method = 'PATCH') {
    try {
      fetch(`${CONFIG.API_BASE_URL}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(body === undefined ? {} : body),
        credentials: 'include',
        cache: 'no-store',
        keepalive: true,
      }).catch(() => {
        /* best-effort by design; nothing useful can be done at unload */
      });
    } catch {
      /* fetch itself can throw synchronously (e.g. body too large); ignore */
    }
  }

  /**
   * Uploads a raw file body (e.g. a profile photo) to a backend endpoint
   * that expects the file's bytes directly as the request body — NOT
   * multipart/form-data. This is the student-facing counterpart of the
   * super admin's MembershipApi#uploadImage: the backend's raw-binary-body
   * image routes (see backend/src/controllers/student.controller.js,
   * adminMembershipMedia.controller.js) read Content-Type as the declared
   * MIME and a `fileName` query parameter for the extension, so this
   * cannot reuse `request()`, which always sends JSON.
   *
   * Same session-refresh-and-retry-once behaviour as request()/send(): a
   * 401 triggers exactly one silent refresh attempt before giving up.
   *
   * @param {string} path      API path, e.g. '/students/me/photo'
   * @param {File|Blob} file   the raw file to upload
   * @returns {Promise<object>} the unwrapped `data` field of the response
   */
  async function uploadFile(path, file) {
    const url = `${CONFIG.API_BASE_URL}${path}${path.includes('?') ? '&' : '?'}fileName=${encodeURIComponent(file.name || 'upload')}`;

    async function doFetch() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await fetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': file.type || 'application/octet-stream',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: file,
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    let res;
    try {
      res = await doFetch();
    } catch (err) {
      const timedOut = err && err.name === 'AbortError';
      throw new ApiError(
        timedOut
          ? 'The upload took too long. Please check your connection and try again.'
          : 'Unable to reach the server. Please check your connection and try again.',
        { status: 0, errorCode: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' }
      );
    }

    if (res.status === 401) {
      const refreshed = await refreshOnce();
      if (refreshed) res = await doFetch();
    }

    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || payload.success === false) {
      throw new ApiError(
        (payload && payload.message) || `Upload failed (${res.status}).`,
        {
          status: res.status,
          errorCode: (payload && payload.errorCode) || 'UNKNOWN',
          errors: (payload && Array.isArray(payload.errors) && payload.errors) || [],
          requestId: payload && payload.requestId,
        }
      );
    }
    return payload.data;
  }

  return {
    request,
    refreshOnce,
    sendOnUnload,
    uploadFile,
    get: (path) => request(path, { method: 'GET' }),
    post: (path, body) => request(path, { method: 'POST', body: body === undefined ? {} : body }),
    // Phase 14: used by learn.js to persist lesson progress/position.
    patch: (path, body) => request(path, { method: 'PATCH', body: body === undefined ? {} : body }),
    delete: (path, body) => request(path, { method: 'DELETE', body: body === undefined ? {} : body }),
  };
})();
