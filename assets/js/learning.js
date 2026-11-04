/**
 * My Learning controller — the student's course library.
 *
 * DATA SOURCE (unchanged): GET /students/me/dashboard -> `myLearnings`.
 * This is exactly the list the old dashboard's "My Learnings" section
 * rendered, so no new endpoint or API contract is introduced. Access rules
 * are untouched: this page only lists what the backend already returned for
 * this authenticated student, and opening a course goes through learn.html,
 * where the backend authorizes every lesson request.
 *
 * FILTERS (All / In Progress / Completed) are VIEWS over that one list, not
 * separate pages or requests. The bucket is derived from the server-supplied
 * `progressPercent` by StudentUI.bucketOf() — no progress is calculated here.
 * A course whose progress the API did not supply never appears under
 * "Completed".
 *
 * Filter state lives in the URL hash (#in-progress / #completed) so the
 * browser Back button and shared links behave, without adding extra pages.
 *
 * All values are written with textContent, never innerHTML.
 */

(async function initLearning() {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  document.documentElement.classList.remove('auth-pending');
  StudentShell.mount({ user, active: 'learning' });

  const $ = (id) => document.getElementById(id);
  const states = {
    loading: $('learning-loading'),
    empty: $('learning-empty'),
    filterEmpty: $('learning-filter-empty'),
    unavailable: $('learning-unavailable'),
    error: $('learning-error'),
    grid: $('learning-grid'),
  };
  const tabsEl = $('learning-tabs');
  const tabs = Array.from(tabsEl.querySelectorAll('.tab'));

  const FILTERS = ['all', 'in-progress', 'completed'];
  let items = [];
  let capabilities = { learningDataAvailable: false };

  function currentFilter() {
    const h = window.location.hash.replace('#', '');
    return FILTERS.includes(h) ? h : 'all';
  }

  function matches(item, filter) {
    if (filter === 'all') return true;
    return StudentUI.bucketOf(item) === filter;
  }

  function updateCounts() {
    $('count-all').textContent = String(items.length);
    $('count-in-progress').textContent = String(items.filter((i) => StudentUI.bucketOf(i) === 'in-progress').length);
    $('count-completed').textContent = String(items.filter((i) => StudentUI.bucketOf(i) === 'completed').length);
  }

  function setSelectedTab(filter) {
    for (const t of tabs) {
      const on = t.dataset.filter === filter;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    $('learning-panel').setAttribute('aria-labelledby', `tab-${filter}`);
  }

  const FILTER_EMPTY_COPY = {
    'in-progress': ['No courses in progress.', 'Courses you have started but not finished will appear here.'],
    completed: ['No completed courses yet.', 'Finish a course and it will show up here.'],
  };

  function render() {
    const filter = currentFilter();
    setSelectedTab(filter);

    if (!items.length) {
      StudentUI.showState(states, capabilities.learningDataAvailable ? 'empty' : 'unavailable');
      tabsEl.hidden = true;
      return;
    }

    tabsEl.hidden = false;
    updateCounts();
    const visible = items.filter((i) => matches(i, filter));

    if (!visible.length) {
      const [title, msg] = FILTER_EMPTY_COPY[filter] || ['Nothing here yet.', ''];
      $('learning-filter-empty-title').textContent = title;
      $('learning-filter-empty-message').textContent = msg;
      StudentUI.showState(states, 'filterEmpty');
      return;
    }

    states.grid.replaceChildren(...visible.map(StudentUI.learningCard));
    StudentUI.showState(states, 'grid');
  }

  function setFilter(filter) {
    const hash = filter === 'all' ? '' : `#${filter}`;
    // replaceState keeps Back from stacking one history entry per tab click.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    render();
  }

  // Tabs: click + arrow-key navigation (WAI-ARIA tabs pattern).
  tabsEl.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) setFilter(t.dataset.filter);
  });
  tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const idx = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    e.preventDefault();
    tabs[next].focus();
    setFilter(tabs[next].dataset.filter);
  });
  $('learning-show-all').addEventListener('click', () => setFilter('all'));
  window.addEventListener('hashchange', render);

  async function load() {
    tabsEl.hidden = true;
    states.loading.replaceChildren(StudentUI.skeletonCards(3));
    StudentUI.showState(states, 'loading');
    try {
      const dashboard = await Api.get('/students/me/dashboard');
      capabilities = dashboard.capabilities || { learningDataAvailable: false };
      items = Array.isArray(dashboard.myLearnings) ? dashboard.myLearnings : [];
      render();
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      $('learning-error-message').textContent =
        err instanceof ApiError && err.message ? err.message : "We couldn't load your learning right now.";
      StudentUI.showState(states, 'error');
    }
  }

  $('learning-retry').addEventListener('click', load);
  load();
})();
