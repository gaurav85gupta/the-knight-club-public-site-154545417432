/**
 * PublicShell — the ONE definition of the public-site header and footer.
 *
 * WHY THIS EXISTS
 * Before this file every public page (index, courses, course, about,
 * testimonials, contact, one-percent-club) carried its own hand-copied
 * <header>/<footer>, each with the same six nav links, the same auth-swap
 * markup and the same footer columns retyped by hand. With no build step,
 * nothing kept them in sync — index.html's footer tagline and "Learning"
 * column had already drifted from the other six pages. This file is the
 * single source: a page adds `<div id="pub-header-root"></div>` /
 * `<div id="pub-footer-root"></div>` and calls `PublicShell.mount({ active })`.
 *
 * LOAD ORDER — THIS MUST STAY NON-DEFERRED, BEFORE nav.js
 * nav.js is itself non-deferred and binds to `[data-site-nav]` the moment it
 * runs; site-theme-toggle.js (deferred) looks for `.pub-header` on
 * DOMContentLoaded. Both assume the header already exists in the DOM by the
 * time they run. So this script must execute synchronously, at the point in
 * <body> where the old <header> used to sit, and before the <script
 * src="nav.js"> tag. It does not touch auth or theme state itself — it only
 * builds the markup those scripts expect, then gets out of the way.
 *
 * WHAT IT DOES NOT DO (deliberately)
 * - No auth logic. `data-auth="guest"` / `data-auth="user"` spans are built
 *   exactly as nav.js expects; nav.js still decides which one is visible.
 * - No theme logic. site-theme-toggle.js still injects its own button.
 * - No `<head>` content. Title/meta/OG tags are legitimately page-specific
 *   and stay hand-written per page.
 */

const PublicShell = (() => {
  // ---- Single source of truth: the six primary nav links ----------------
  // `id` is also used as the active-page key passed to mount({ active }).
  const NAV_LINKS = [
    { id: 'home', label: 'Home', href: 'index.html' },
    { id: 'courses', label: 'Courses', href: 'pages/courses.html' },
    { id: 'one-percent', label: '1% Club', href: 'pages/one-percent-club.html', cls: 'nav-club' },
    { id: 'about', label: 'About', href: 'pages/about.html' },
    { id: 'testimonials', label: 'Testimonials', href: 'pages/testimonials.html' },
    { id: 'contact', label: 'Contact', href: 'pages/contact.html' },
  ];

  // Site-wide identity (previously hardcoded separately in every header,
  // footer brand, and <title> tag).
  const SITE_NAME = 'The Knight Club';
  const SITE_TAGLINE =
    'A premium platform for learning new skills through expert-led courses.';

  // Verified contact details — same values already shown on
  // pages/contact.html (both in its "Direct contact" section and its
  // Organization/ContactPoint JSON-LD), reused here rather than
  // re-typed so the two never drift apart.
  const SITE_EMAIL = 'theknightclub2007@gmail.com';
  const SITE_PHONE_DISPLAY = '+91 89535 47403';
  const SITE_PHONE_TEL = '+918953547403';

  // `course.html` is a page under /pages/ but isn't one of the six primary
  // nav items; it should still highlight "Courses" as its parent.
  const PARENT = { course: 'courses' };

  // ---- Path resolution ----------------------------------------------------
  // All hrefs in NAV_LINKS are written root-relative (as index.html would
  // link them). Pages under /pages/ need every href rewritten relative to
  // their own location instead.
  function resolveHref(href, fromPages) {
    if (!fromPages) return href;
    if (href === 'index.html') return '../index.html';
    return href.replace(/^pages\//, '');
  }

  // ---- Small DOM helpers ---------------------------------------------------
  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  // Cart icon (same glyph/markup as the student shell's nav-level cart
  // button — see student-shell.js). Shown only for signed-in visitors
  // (nav.js toggles `data-auth="user"`), with a live item-count badge
  // driven by Cart.onCountChange / Cart.fetchCount (cart.js), exactly the
  // same wiring the student shell already uses.
  function cartLink(fromPages) {
    const a = el('a', 'cart-nav-btn');
    a.href = resolveHref('pages/cart.html', fromPages);
    a.id = 'pub-cart-btn';
    a.setAttribute('aria-label', 'Shopping Cart');

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '20');
    icon.setAttribute('height', '20');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.8');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
      '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>' +
      '<line x1="3" y1="6" x2="21" y2="6"/>' +
      '<path d="M16 10a4 4 0 0 1-8 0"/>';

    const badge = el('span', 'cart-badge cart-badge--hidden');
    badge.id = 'pub-cart-badge';
    badge.setAttribute('aria-live', 'polite');
    badge.setAttribute('aria-atomic', 'true');

    a.append(icon, badge);
    return a;
  }

  function brandLink(fromPages) {
    const a = el('a', 'brand');
    a.href = fromPages ? '../index.html' : 'index.html';
    a.setAttribute('aria-label', `${SITE_NAME} — home`);

    const assetPrefix = fromPages ? '../' : '';
    const logo = document.createElement('img');
    logo.className = 'brand-mark';
    logo.src = `${assetPrefix}assets/images/knight-emblem-nav.png`;
    logo.srcset =
      `${assetPrefix}assets/images/knight-emblem-nav.png 1x, ` +
      `${assetPrefix}assets/images/knight-emblem-nav@2x.png 2x`;
    logo.width = 32;
    logo.height = 32;
    logo.alt = '';
    logo.setAttribute('aria-hidden', 'true');
    a.appendChild(logo);

    a.append('The ');
    const span = document.createElement('span');
    span.textContent = 'Knight Club';
    a.appendChild(span);
    return a;
  }

  // ---- Header ---------------------------------------------------------------
  function buildHeader(activeKey, fromPages) {
    const header = el('header', 'pub-header');
    header.setAttribute('data-site-nav', '');

    header.appendChild(brandLink(fromPages));

    const toggle = el('button', 'nav-toggle');
    toggle.type = 'button';
    toggle.setAttribute('data-nav-toggle', '');
    toggle.setAttribute('aria-label', 'Toggle menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'primary-nav');
    toggle.innerHTML =
      '<svg class="icon-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' +
      '<svg class="icon-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    header.appendChild(toggle);

    const nav = el('nav', 'site-nav');
    nav.id = 'primary-nav';
    nav.setAttribute('aria-label', 'Primary');

    const links = el('div', 'nav-links');
    for (const item of NAV_LINKS) {
      const a = el('a', item.cls);
      a.href = resolveHref(item.href, fromPages);
      a.textContent = item.label;
      if (item.id === activeKey) a.setAttribute('aria-current', 'page');
      links.appendChild(a);
    }
    nav.appendChild(links);

    const actions = el('div', 'nav-actions');
    actions.setAttribute('data-auth-pending', '');

    const guest = el('span');
    guest.setAttribute('data-auth', 'guest');
    const getStarted = el('a', 'btn btn-primary btn-sm');
    getStarted.href = resolveHref('pages/signup.html', fromPages);
    getStarted.textContent = 'Get Started';
    const login = el('a', 'btn btn-outline btn-sm');
    login.href = resolveHref('pages/login.html', fromPages);
    login.textContent = 'Login';
    guest.append(getStarted, login);

    const user = el('span');
    user.setAttribute('data-auth', 'user');
    user.hidden = true;
    user.appendChild(cartLink(fromPages));
    const dashboard = el('a', 'btn btn-primary btn-sm');
    dashboard.href = resolveHref('pages/dashboard.html', fromPages);
    dashboard.textContent = 'Dashboard';
    user.appendChild(dashboard);

    actions.append(guest, user);
    nav.appendChild(actions);
    header.appendChild(nav);

    return header;
  }

  // ---- Footer -----------------------------------------------------------------
  function buildFooter(activeKey, fromPages) {
    const footer = el('footer', 'pub-footer');
    const container = el('div', 'container');
    const grid = el('div', 'footer-grid');

    const brandCol = el('div', 'footer-col footer-brand');
    brandCol.appendChild(brandLink(fromPages));
    const tagline = el('p');
    tagline.textContent = SITE_TAGLINE;
    brandCol.appendChild(tagline);

    const exploreNav = el('nav', 'footer-col');
    exploreNav.setAttribute('aria-label', 'Explore');
    const exploreHeading = el('h4');
    exploreHeading.textContent = 'Explore';
    exploreNav.appendChild(exploreHeading);
    for (const item of NAV_LINKS) {
      const a = el('a');
      a.href = resolveHref(item.href, fromPages);
      a.textContent = item.label;
      if (item.id === activeKey) a.setAttribute('aria-current', 'page');
      exploreNav.appendChild(a);
    }

    const accountNav = el('nav', 'footer-col');
    accountNav.setAttribute('aria-label', 'Account');
    const accountHeading = el('h4');
    accountHeading.textContent = 'Account';
    accountNav.appendChild(accountHeading);

    const guest = el('span');
    guest.setAttribute('data-auth', 'guest');
    const login = el('a');
    login.href = resolveHref('pages/login.html', fromPages);
    login.textContent = 'Login';
    const getStarted = el('a');
    getStarted.href = resolveHref('pages/signup.html', fromPages);
    getStarted.textContent = 'Get Started';
    guest.append(login, getStarted);

    const user = el('span');
    user.setAttribute('data-auth', 'user');
    user.hidden = true;
    const dashboard = el('a');
    dashboard.href = resolveHref('pages/dashboard.html', fromPages);
    dashboard.textContent = 'Dashboard';
    user.appendChild(dashboard);

    accountNav.append(guest, user);

    // Contact column: verified email + phone (see SITE_EMAIL/SITE_PHONE_*
    // above), reachable as real tel:/mailto: links from every page's
    // footer instead of only being findable via the Contact page.
    const contactCol = el('div', 'footer-col footer-contact');
    const contactHeading = el('h4');
    contactHeading.textContent = 'Contact';
    contactCol.appendChild(contactHeading);

    const emailLink = el('a');
    emailLink.href = `mailto:${SITE_EMAIL}`;
    emailLink.textContent = SITE_EMAIL;
    contactCol.appendChild(emailLink);

    const phoneLink = el('a');
    phoneLink.href = `tel:${SITE_PHONE_TEL}`;
    phoneLink.textContent = SITE_PHONE_DISPLAY;
    contactCol.appendChild(phoneLink);

    grid.append(brandCol, exploreNav, accountNav, contactCol);

    const bottom = el('div', 'footer-bottom');
    const copy = el('p');
    copy.textContent = `\u00A9 ${new Date().getFullYear()} ${SITE_NAME}. All rights reserved.`;
    bottom.appendChild(copy);
    const legal = el('nav');
    legal.setAttribute('aria-label', 'Legal');
    legal.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem 1.25rem;';
    [['Terms', 'pages/policy-terms.html'], ['Privacy', 'pages/policy-privacy.html'],
     ['Refunds', 'pages/policy-refund.html'], ['IP Policy', 'pages/policy-intellectual-property.html']]
      .forEach(([label, href]) => {
        const a = el('a');
        a.href = resolveHref(href, fromPages);
        a.textContent = label;
        legal.appendChild(a);
      });
    bottom.appendChild(legal);

    container.append(grid, bottom);
    footer.appendChild(container);
    return footer;
  }

  // ---- Public API -------------------------------------------------------------
  /**
   * @param {object} opts
   * @param {string} opts.active  page key: home|courses|course|one-percent|about|testimonials|contact
   */
  function mount({ active } = {}) {
    const activeKey = PARENT[active] || active;

    const headerHost = document.getElementById('pub-header-root');
    const footerHost = document.getElementById('pub-footer-root');
    // Pages under /pages/ need every generated href resolved one level up;
    // index.html does not. Detect it the same way the markup already does:
    // the header host's position in the DOM doesn't tell us this reliably,
    // so each page simply declares it in the host's data attribute.
    const fromPages = Boolean(headerHost && headerHost.dataset.fromPages !== undefined
      ? headerHost.dataset.fromPages === 'true'
      : footerHost && footerHost.dataset.fromPages === 'true');

    if (headerHost) {
      headerHost.replaceChildren(buildHeader(activeKey, fromPages));
    }
    if (footerHost) {
      footerHost.replaceChildren(buildFooter(activeKey, fromPages));
    }

    // Smooth scrolling is initialised here once, for every page that mounts
    // the shell. Config lives in assets/js/core/smooth-scroll.js.
    if (window.SmoothScroll) window.SmoothScroll.init();
  }

  return { mount, NAV_LINKS, SITE_NAME, SITE_TAGLINE };
})();