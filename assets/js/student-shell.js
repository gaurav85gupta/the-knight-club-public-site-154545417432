/**
 * StudentShell — the ONE definition of the student-area header, account
 * dropdown, mobile navigation and footer.
 *
 * WHY THIS EXISTS
 * Before this file every student page carried its own hand-copied <header>
 * (Dashboard, Orders, Order Detail, Learn...), each with a different set of
 * links. The site has no build step, so the shell is injected from here:
 * a page adds `<div id="student-header"></div>` / `<div id="student-footer">`
 * and calls `StudentShell.mount({ active: 'orders' })`.
 *
 * WHAT IT DOES NOT DO (deliberately)
 * - It does not authenticate anything. Pages still call `Auth.requireAuth()`
 *   themselves and pass the resulting user to `mount()`. The header is
 *   display only; the backend decides access on every API call.
 * - It does not add a second sign-out implementation. Logout calls the
 *   existing `Auth.logout()` and then redirects exactly like dashboard.js did.
 * - It never uses innerHTML with user/API data. Only static markup is built
 *   with innerHTML; every user-derived string goes through textContent.
 *
 * Depends on: auth.js (Auth). Optionally theme-toggle.js (ThemeToggle) — if it
 * is not loaded the header simply renders without the Day/Night button.
 */

const StudentShell = (() => {
  // ---- Navigation model (single source of truth) ----------------------------
  // `key` is what pages pass as `active`. Hrefs are relative to /pages/.
  const PRIMARY = [
    { key: 'courses', label: 'Browse Courses', href: 'courses.html' },
    { key: 'learning', label: 'My Learning', href: 'learning.html' },
    { key: 'orders', label: 'My Orders', href: 'orders.html' },
  ];

  const ACCOUNT_MENU = [
    { key: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'grid' },
    { key: 'learning', label: 'My Learning', href: 'learning.html', icon: 'book' },
    { key: 'orders', label: 'My Orders', href: 'orders.html', icon: 'receipt' },
    { key: 'profile', label: 'Profile', href: 'profile.html', icon: 'user' },
    { key: 'settings', label: 'Settings', href: 'settings.html', icon: 'cog' },
  ];

  // Pages that live "under" a nav item keep that item highlighted.
  const PARENT = {
    'order-detail': 'orders',
    'change-password': 'settings',
  };

  // ---- Icons: one lightweight stroke set (matches the inline SVGs already
  // used in learn.js). Static strings only — never built from data. ----------
  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    // activity glyphs (dashboard Recent Activity)
    learning: '<path d="M8 5v14l11-7z"/>',
    completed: '<path d="M5 13l4 4L19 7"/>',
    purchase: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    // Phase 29: Cart icon
    cart: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  };

  function svg(name, size = 18) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', String(size));
    s.setAttribute('height', String(size));
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.innerHTML = ICONS[name] || ''; // static, trusted markup only
    return s;
  }

  // ---- Small DOM helpers -----------------------------------------------------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(item, className, activeKey) {
    const a = el('a', className, item.label);
    a.href = item.href;
    if (item.key === activeKey) {
      a.classList.add('is-active');
      a.setAttribute('aria-current', 'page');
    }
    return a;
  }

  // ---- Identity display ------------------------------------------------------
  /** Best real display name: full name, else User ID. Never a hardcoded string. */
  function displayName(user) {
    return ((user && user.fullName) || '').trim() || (user && user.userId) || '';
  }

  function initial(user) {
    return (displayName(user).charAt(0) || '?').toUpperCase();
  }

  /** Human label for the role field, only if the API actually supplied one. */
  function roleLabel(user) {
    const r = user && user.role ? String(user.role) : '';
    return r ? r.charAt(0).toUpperCase() + r.slice(1).toLowerCase() : '';
  }

  // ---- Header ------------------------------------------------------------------
  function buildHeader(user, activeKey) {
    const header = el('header', 'student-header');
    const bar = el('div', 'container student-header-bar');

    const brand = el('a', 'brand');
    brand.href = '../index.html';
    brand.append('The ');
    brand.appendChild(el('span', null, 'Knight Club'));

    // Desktop primary nav
    const nav = el('nav', 'student-nav');
    nav.setAttribute('aria-label', 'Primary');
    for (const item of PRIMARY) nav.appendChild(link(item, 'student-nav-link', activeKey));

    // Account dropdown (desktop)
    const account = el('div', 'account-menu');
    const trigger = el('button', 'account-trigger');
    trigger.type = 'button';
    trigger.id = 'account-trigger';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'account-panel');
    const avatar = el('span', 'avatar avatar-sm', initial(user));
    avatar.setAttribute('aria-hidden', 'true');
    const triggerName = el('span', 'account-trigger-name', displayName(user));
    const chev = svg('chevron', 16);
    chev.classList.add('account-chevron');
    trigger.append(avatar, triggerName, chev);

    const panel = el('div', 'account-panel');
    panel.id = 'account-panel';
    panel.hidden = true;

    const who = el('div', 'account-who');
    who.appendChild(el('p', 'account-who-name', displayName(user)));
    const role = roleLabel(user);
    if (role) who.appendChild(el('p', 'account-who-role', role));
    panel.appendChild(who);

    const list = el('div', 'account-list');
    list.setAttribute('role', 'menu');
    for (const item of ACCOUNT_MENU) {
      const a = el('a', 'account-item');
      a.href = item.href;
      a.setAttribute('role', 'menuitem');
      if (item.key === activeKey) {
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
      }
      a.append(svg(item.icon, 18), el('span', null, item.label));
      list.appendChild(a);
    }
    panel.appendChild(list);

    const out = el('button', 'account-item account-signout');
    out.type = 'button';
    out.setAttribute('role', 'menuitem');
    out.dataset.action = 'signout';
    out.append(svg('logout', 18), el('span', null, 'Sign out'));
    panel.appendChild(out);

    account.append(trigger, panel);

    // Right-hand cluster: [theme toggle][cart][account]. `margin-left:auto`
    // moves from .account-menu to this wrapper (see student.css / student-theme.css).
    const actions = el('div', 'student-header-actions');
    if (typeof ThemeToggle !== 'undefined') actions.appendChild(ThemeToggle.create('theme-toggle--header'));

    // Phase 29: Cart icon button with item count badge.
    // The badge is updated after mount via Cart.onCountChange listeners.
    const cartLink = el('a', 'cart-nav-btn');
    cartLink.href = 'cart.html';
    cartLink.setAttribute('aria-label', 'Shopping Cart');
    cartLink.id = 'shell-cart-btn';
    const cartIcon = svg('cart', 20);
    const cartBadge = el('span', 'cart-badge cart-badge--hidden');
    cartBadge.id = 'shell-cart-badge';
    cartBadge.setAttribute('aria-live', 'polite');
    cartBadge.setAttribute('aria-atomic', 'true');
    cartLink.append(cartIcon, cartBadge);
    actions.appendChild(cartLink);

    actions.appendChild(account);

    // Mobile menu button
    const burger = el('button', 'mobile-toggle');
    burger.type = 'button';
    burger.id = 'mobile-toggle';
    burger.setAttribute('aria-label', 'Open menu');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-controls', 'mobile-drawer');
    burger.appendChild(svg('menu', 22));

    bar.append(brand, nav, actions, burger);
    header.appendChild(bar);
    return header;
  }

  // ---- Mobile drawer -----------------------------------------------------------
  function buildDrawer(user, activeKey) {
    const wrap = el('div', 'mobile-drawer-wrap');
    wrap.hidden = true;

    const backdrop = el('div', 'mobile-backdrop');
    backdrop.dataset.action = 'close-drawer';

    const drawer = el('aside', 'mobile-drawer');
    drawer.id = 'mobile-drawer';
    drawer.setAttribute('aria-label', 'Account navigation');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');

    const top = el('div', 'mobile-drawer-top');
    const idWrap = el('div', 'mobile-identity');
    const avatar = el('span', 'avatar', initial(user));
    avatar.setAttribute('aria-hidden', 'true');
    const text = el('div');
    text.appendChild(el('p', 'account-who-name', displayName(user)));
    const role = roleLabel(user);
    if (role) text.appendChild(el('p', 'account-who-role', role));
    idWrap.append(avatar, text);
    const close = el('button', 'mobile-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close menu');
    close.dataset.action = 'close-drawer';
    close.appendChild(svg('close', 22));
    top.append(idWrap, close);

    const links = el('nav', 'mobile-links');
    links.setAttribute('aria-label', 'Student');
    const seen = new Set();
    const all = [
      { key: 'courses', label: 'Browse Courses', href: 'courses.html', icon: 'grid' },
      ...ACCOUNT_MENU,
    ];
    for (const item of all) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      const a = el('a', 'mobile-link');
      a.href = item.href;
      if (item.key === activeKey) {
        a.classList.add('is-active');
        a.setAttribute('aria-current', 'page');
      }
      a.append(svg(item.icon, 20), el('span', null, item.label));
      links.appendChild(a);
    }

    const out = el('button', 'mobile-link mobile-signout');
    out.type = 'button';
    out.dataset.action = 'signout';
    out.append(svg('logout', 20), el('span', null, 'Sign out'));

    // Appearance row — on phones the desktop header cluster is hidden, so the
    // toggle lives here (a full-size 48px row: comfortable touch target).
    const appearance = el('div', 'mobile-appearance');
    if (typeof ThemeToggle !== 'undefined') {
      appearance.appendChild(el('span', 'mobile-appearance-label', 'Appearance'));
      appearance.appendChild(ThemeToggle.create('theme-toggle--drawer'));
    }

    if (appearance.childNodes.length) drawer.append(top, links, appearance, out);
    else drawer.append(top, links, out);
    wrap.append(backdrop, drawer);
    return wrap;
  }

  // ---- Footer ------------------------------------------------------------------
  function buildFooter() {
    const footer = el('footer', 'student-footer');
    const inner = el('div', 'container student-footer-inner');
    const copy = el('p', null, `\u00A9 ${new Date().getFullYear()} The Knight Club. All rights reserved.`);
    const links = el('nav', 'student-footer-links');
    links.setAttribute('aria-label', 'Footer');
    for (const [label, href] of [['Courses', 'courses.html'], ['About', 'about.html'], ['Contact', 'contact.html']]) {
      const a = el('a', null, label);
      a.href = href;
      links.appendChild(a);
    }
    inner.append(copy, links);
    footer.appendChild(inner);
    return footer;
  }

  // ---- Behaviour ---------------------------------------------------------------
  function wireBehaviour(root) {
    const trigger = root.querySelector('#account-trigger');
    const panel = root.querySelector('#account-panel');
    const burger = root.querySelector('#mobile-toggle');
    const drawerWrap = root.querySelector('.mobile-drawer-wrap');
    const drawer = root.querySelector('#mobile-drawer');
    let lastFocus = null;

    function setMenu(open) {
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      trigger.classList.toggle('is-open', open);
    }

    function setDrawer(open) {
      drawerWrap.hidden = !open;
      burger.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('drawer-open', open);
      if (open) {
        lastFocus = document.activeElement;
        // Focus the first focusable control inside the drawer.
        requestAnimationFrame(() => {
          const first = drawer.querySelector('a, button');
          if (first) first.focus();
        });
      } else if (lastFocus) {
        lastFocus.focus();
        lastFocus = null;
      }
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenu(panel.hidden);
    });
    burger.addEventListener('click', () => setDrawer(true));

    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && !trigger.contains(e.target)) setMenu(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!panel.hidden) { setMenu(false); trigger.focus(); }
        if (!drawerWrap.hidden) setDrawer(false);
      }
      // Minimal focus trap while the modal drawer is open.
      if (e.key === 'Tab' && !drawerWrap.hidden) {
        const f = drawer.querySelectorAll('a[href], button:not([disabled])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    root.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'close-drawer') setDrawer(false);
      if (target.dataset.action === 'signout') signOut(target);
    });

    // Leaving the mobile breakpoint while the drawer is open must not leave
    // the body scroll-locked.
    window.matchMedia('(min-width: 861px)').addEventListener('change', (m) => {
      if (m.matches && !drawerWrap.hidden) setDrawer(false);
    });
  }

  /**
   * Same behaviour dashboard.js had: existing Auth.logout(), one-shot notice,
   * redirect to login. Not a second implementation — a shared call site.
   */
  async function signOut(button) {
    document.querySelectorAll('[data-action="signout"]').forEach((b) => { b.disabled = true; });
    if (button) button.setAttribute('aria-busy', 'true');
    await Auth.logout();
    Auth.setNotice('You have been signed out.', 'info');
    window.location.replace(Auth.urlFor(Auth.PATHS.login));
  }

  // ---- Public API ---------------------------------------------------------------
  /**
   * @param {object}  opts
   * @param {object}  opts.user    the user returned by Auth.requireAuth()
   * @param {string}  opts.active  page key: dashboard|learning|orders|order-detail|profile|settings|change-password|courses
   */
  function mount({ user, active }) {
    const activeKey = PARENT[active] || active;

    const headerHost = document.getElementById('student-header');
    if (headerHost) {
      headerHost.replaceChildren(buildHeader(user, activeKey), buildDrawer(user, activeKey));
      wireBehaviour(headerHost);
    }
    const footerHost = document.getElementById('student-footer');
    if (footerHost) footerHost.replaceChildren(buildFooter());

    // Signing out in another tab signs this one out too (same as dashboard.js).
    Auth.onChange((u) => {
      if (!u) window.location.replace(Auth.urlFor(Auth.PATHS.login));
    });

    // Phase 29: Initialize cart badge count and subscribe to changes.
    // Cart.js must be loaded before student-shell.js for this to work.
    // If Cart is not loaded (e.g. on a page that hasn't included cart.js),
    // the badge simply stays hidden rather than erroring.
    if (typeof Cart !== 'undefined') {
      // Apply count to badge element by ID (rendered above in buildHeader).
      function applyCartCount(count) {
        const badge = document.getElementById('shell-cart-badge');
        if (!badge) return;
        if (!count || count <= 0) {
          badge.textContent = '';
          badge.classList.add('cart-badge--hidden');
        } else {
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.classList.remove('cart-badge--hidden');
        }
      }
      Cart.onCountChange(applyCartCount);
      // Fetch initial count (non-blocking — badge updates asynchronously).
      Cart.fetchCount().then(applyCartCount).catch(() => { /* silent */ });
    }
  }

  return { mount, displayName, initial, svg, el };
})();
