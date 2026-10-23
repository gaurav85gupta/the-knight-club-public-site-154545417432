/**
 * Profile controller — personal information (read-only) + profile photo
 * (upload / replace / remove).
 *
 * DATA: the same `user` object Auth.requireAuth() gets from GET /auth/me,
 * rendering exactly the fields the signup form collects (User ID, name,
 * mobile, state, role, status, photoUrl). The mobile number arrives
 * ALREADY MASKED by the server; nothing here unmasks it. No password, hash,
 * token or internal field is ever rendered.
 *
 * PERSONAL INFORMATION STAYS READ-ONLY: the codebase has no field-editing
 * API call for name/mobile/state here, and the refactor brief says not to
 * grow this page into a new profile-management system. This phase adds
 * ONLY the profile-photo section (its own, already-scoped feature), using
 * POST/DELETE /students/me/photo.
 *
 * The big header avatar above the photo card is DELIBERATELY left showing
 * initials only (never the photo) — this page's own choice, independent of
 * the navbar avatar (StudentShell), which does show the photo.
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
  // 1% Club badge — best-effort; /auth/me does not carry membership, /students/me does.
  Api.get('/students/me')
    .then((me) => {
      if (me && me.isMember) {
        document.getElementById('profile-userid').parentNode.appendChild(el('span', 'member-badge', '1% Club Member'));
      }
    })
    .catch(() => { /* badge is optional — never break the profile page */ });

  const role = document.getElementById('profile-role');
  role.textContent = user.role || '';
  role.hidden = !user.role;

  const rows = [
    ['Full name', user.fullName],
    ['User ID', user.userId],
    ['Mobile', user.mobile],
    ['State', user.state],
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

  initProfilePhoto(user);
})();

/**
 * Profile photo section: preview, select, upload, replace, remove.
 *
 * PATTERN: mirrors change-password.js's alert/busy-button conventions
 * (Forms.showAlert/hideAlert) rather than inventing new ones.
 *
 * ALWAYS-CURRENT PREVIEW: the avatar shown HERE (the small preview inside
 * this card) is driven entirely by `currentUser` (photoUrl or initials) —
 * never by the locally-chosen File object once a real server response has
 * come back. A local object URL is used ONLY for the brief instant between
 * "file chosen" and "upload finished/failed", so what's on screen always
 * matches what's actually saved. This does NOT touch #profile-avatar (the
 * big header circle), which intentionally always shows initials.
 */
function initProfilePhoto(initialUser) {
  const MAX_BYTES = 10 * 1024 * 1024; // mirrors the backend's documented default (10 MB)
  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  const row = document.getElementById('photo-row');
  const preview = document.getElementById('photo-preview');
  const alertEl = document.getElementById('photo-alert');
  const chooseBtn = document.getElementById('photo-choose-btn');
  const removeBtn = document.getElementById('photo-remove-btn');
  const input = document.getElementById('photo-input');

  let user = initialUser;
  let busy = false;
  let objectUrl = null;

  function revokeObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  /** Renders the preview avatar from the current user (photo or initials). */
  function renderPreview() {
    preview.classList.toggle('avatar-photo', Boolean(user.photoUrl));
    if (user.photoUrl) {
      preview.textContent = '';
      let img = preview.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        img.addEventListener('error', () => {
          // Broken/unreachable image: fall back to initials rather than a
          // broken-image icon (spec §7: "show the default avatar... when
          // the image cannot load").
          preview.classList.remove('avatar-photo');
          preview.textContent = StudentShell.initial(user);
        });
        preview.appendChild(img);
      }
      img.src = user.photoUrl;
    } else {
      preview.textContent = StudentShell.initial(user);
    }
    removeBtn.hidden = !user.photoUrl;
  }

  /** Shows a local preview of the chosen file immediately (before upload completes). */
  function renderLocalPreview(file) {
    revokeObjectUrl();
    objectUrl = URL.createObjectURL(file);
    preview.classList.add('avatar-photo');
    preview.textContent = '';
    let img = preview.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      preview.appendChild(img);
    }
    img.src = objectUrl;
  }

  function setBusy(isBusy) {
    busy = isBusy;
    row.classList.toggle('is-uploading', isBusy);
    chooseBtn.disabled = isBusy;
    removeBtn.disabled = isBusy;
    input.disabled = isBusy;
  }

  function applyUpdatedUser(updated) {
    user = { ...user, ...updated };
    Auth.updateUser(updated); // keeps the navbar avatar (StudentShell) in sync
    revokeObjectUrl();
    renderPreview();
  }

  function validateLocally(file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Please choose a JPEG, PNG or WebP image.';
    }
    if (file.size > MAX_BYTES) {
      return 'Image must be smaller than 10 MB.';
    }
    if (file.size === 0) {
      return 'That file appears to be empty.';
    }
    return null;
  }

  chooseBtn.addEventListener('click', () => {
    if (busy) return;
    input.click();
  });

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = ''; // allow re-choosing the same file later
    if (!file || busy) return;

    Forms.hideAlert(alertEl);

    // Client-side pre-check is a UX convenience only — the server performs
    // the authoritative validation (type, size, and magic-byte content
    // check) regardless of what this check allows through.
    const localError = validateLocally(file);
    if (localError) {
      Forms.showAlert(alertEl, localError);
      return;
    }

    renderLocalPreview(file);
    setBusy(true);
    try {
      const updated = await Api.uploadFile('/students/me/photo', file);
      applyUpdatedUser(updated);
      StudentUI.toast('Profile photo updated.');
    } catch (err) {
      revokeObjectUrl();
      renderPreview(); // revert to the last known-good state
      if (Auth.handleSessionError(err)) return;
      if (err instanceof ApiError && err.isRateLimited) {
        Forms.showAlert(alertEl, 'Too many changes. Please wait a few minutes and try again.');
      } else if (err instanceof ApiError) {
        Forms.showAlert(alertEl, err.message);
      } else {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  });

  removeBtn.addEventListener('click', async () => {
    if (busy || !user.photoUrl) return;
    Forms.hideAlert(alertEl);
    setBusy(true);
    try {
      const updated = await Api.delete('/students/me/photo');
      applyUpdatedUser(updated);
      StudentUI.toast('Profile photo removed.');
    } catch (err) {
      if (Auth.handleSessionError(err)) return;
      if (err instanceof ApiError && err.isRateLimited) {
        Forms.showAlert(alertEl, 'Too many changes. Please wait a few minutes and try again.');
      } else if (err instanceof ApiError) {
        Forms.showAlert(alertEl, err.message);
      } else {
        Forms.showAlert(alertEl, 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  });

  renderPreview();
}
