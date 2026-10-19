/**
 * Catalog — thin wrapper over Api for the PUBLIC catalog endpoints
 * (Phase 9). Every call here hits an unauthenticated, GET-only backend
 * route that is unconditionally scoped to PUBLISHED+PUBLIC courses and
 * ACTIVE categories/instructors — see backend/src/services/publicCourse.service.js.
 *
 * This file does no filtering of its own and trusts nothing it wasn't given
 * by the server: the backend is the only authority on what is public.
 *
 * Query building: only known, whitelisted parameters are ever sent, and
 * empty/undefined values are omitted rather than sent as "undefined" or "".
 */

const Catalog = (() => {
  function buildQuery(params) {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === '') continue;
      usp.set(key, String(value));
    }
    const qs = usp.toString();
    return qs ? `?${qs}` : '';
  }

  /** @returns {Promise<{items: object[], pagination: object}>} */
  function listCourses({ search, category, instructor, sort, page, limit } = {}) {
    return Api.get(`/courses${buildQuery({ search, category, instructor, sort, page, limit })}`);
  }

  /** @returns {Promise<{course: object}>} */
  function getCourse(slug) {
    return Api.get(`/courses/${encodeURIComponent(slug)}`);
  }

  /** @returns {Promise<{modules: object[]}>} */
  function getCurriculum(slug) {
    return Api.get(`/courses/${encodeURIComponent(slug)}/curriculum`);
  }

  /** @returns {Promise<{items: object[]}>} */
  function listCategories({ search, sort, page, limit } = {}) {
    return Api.get(`/categories${buildQuery({ search, sort, page, limit })}`);
  }

  /** @returns {Promise<{items: object[]}>} */
  function listInstructors({ search, sort, page, limit } = {}) {
    return Api.get(`/instructors${buildQuery({ search, sort, page, limit })}`);
  }

  return { listCourses, getCourse, getCurriculum, listCategories, listInstructors };
})();
