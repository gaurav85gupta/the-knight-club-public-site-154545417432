/**
 * Settings controller — a hub linking to Profile and Change Password, plus a
 * read-only account-status card. Pure navigation + display: it performs no
 * account mutation itself and calls no API beyond the shared auth guard.
 * Status/role text comes from the authenticated user object, never hardcoded.
 */

(async function initSettings() {
  const user = await Auth.requireAuth();
  Auth.guardBfcache();
  document.documentElement.classList.remove('auth-pending');
  StudentShell.mount({ user, active: 'settings' });

  const status = user.status ? String(user.status) : '';
  document.getElementById('status-value').textContent =
    status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : '\u2014';

  const role = user.role ? String(user.role) : '';
  document.getElementById('status-role').textContent =
    role ? `${role.charAt(0).toUpperCase()}${role.slice(1).toLowerCase()} account` : '';
})();
