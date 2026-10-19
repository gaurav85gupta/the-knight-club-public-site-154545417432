/**
 * Profile controller — personal information (read-only).
 *
 * DATA: the same `user` object Auth.requireAuth() gets from GET /auth/me,
 * rendering exactly the fields the old dashboard "Profile" section showed
 * (User ID, name, mobile, date of birth, city/state, role, status). The
 * mobile number arrives ALREADY MASKED by the server; nothing here unmasks
 * it. No password, hash, token or internal field is ever rendered.
 *
 * NO EDITING: the codebase has no profile-update code or API call, and the
 * refactor brief says not to grow this UI task into a new profile-management
 * system. So this page is deliberately read-only.
 *
 * All values are written with textContent, never innerHTML.
 */

(async function initProfile() {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  document.documentElement.classList.remove('auth-pending');
  StudentShell.mount({ user, active: 'profile' });

  const { el } = StudentUI;

  document.getElementById('profile-avatar').textContent = StudentShell.initial(user);
  document.getElementById('profile-name').textContent = StudentShell.displayName(user);
  document.getElementById('profile-userid').textContent = `User ID: ${user.userId}`;
  const role = document.getElementById('profile-role');
  role.textContent = user.role || '';
  role.hidden = !user.role;

  const cityState = [user.city, user.state].filter(Boolean).join(', ');
  const rows = [
    ['Full name', user.fullName],
    ['User ID', user.userId],
    ['Mobile', user.mobile],
    ['Date of birth', user.dateOfBirth],
    ['City', cityState],
    ['Account status', user.status],
  ];

  const list = document.getElementById('profile-list');
  const frag = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const row = el('div', 'kv-row');
    row.appendChild(el('dt', null, label));
    const dd = el('dd');
    if (label === 'Account status' && value) {
      dd.appendChild(el('span', 'badge', value));
    } else {
      dd.textContent = value || '\u2014';
    }
    row.appendChild(dd);
    frag.appendChild(row);
  }
  list.replaceChildren(frag);
})();
