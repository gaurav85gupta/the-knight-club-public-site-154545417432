# The Knight Club — Public Website

The student-facing marketing and learning site. Framework-free by design:
**HTML5 + CSS3 + Vanilla JavaScript only.**

## What this application does

Serves the public-facing pages of The Knight Club. Phase 0 established the
foundation (structure, design tokens, API wiring). **Phase 2 adds student
authentication**: signup, login, a protected dashboard shell and change-password.
Course catalog, checkout and learning arrive in later phases.

## Tech stack

- HTML5
- CSS3 (custom properties / design tokens — no framework, no preprocessor)
- Vanilla JavaScript (no React/Vue/Angular/Svelte)

## Running locally

No build step is required. Serve the folder with any static file server, e.g.:

```bash
npx serve . -l 3000
# or
python3 -m http.server 3000
```

Then open `http://localhost:3000`.

The backend must be running at `http://localhost:5000` (see `/backend/README.md`)
for the API connectivity check on the homepage to succeed.

## Folder structure

```
public-website/
├── assets/
│   ├── css/       → tokens.css, theme.css, base.css, site.css, public.css (shared public shell),
│   │                home.css, about.css, testimonials.css, one-percent.css, auth.css (auth pages)
│   ├── js/        → config.js (API base URL)
│   │                api.js    (fetch wrapper: CSRF header, ApiError, silent refresh)
│   │                auth.js   (Auth: session state, requireAuth guard)
│   │                forms.js  (validation + UI helpers)
│   │                signup.js / login.js / dashboard.js (page controllers), main.js
│   ├── images/
│   └── icons/
├── pages/         → courses, course, about, testimonials, contact, one-percent-club (public);
│                signup, login (auth); dashboard and other student pages (protected)
├── index.html
└── README.md
```

## Public site structure

Six primary public pages share one header and footer, in this fixed order:

| Nav label    | File                          | Notes |
| ------------ | ----------------------------- | ----- |
| Home         | `index.html`                  | Canonical Home; the brand/logo links here |
| Courses      | `pages/courses.html`          | Catalog (search, sort, categories, pagination) |
| About        | `pages/about.html`            | Mission, learning philosophy, values |
| Testimonials | `pages/testimonials.html`     | Honest empty state; no testimonial data source exists yet |
| Contact      | `pages/contact.html`          | |
| 1% Club      | `pages/one-percent-club.html` | Informational brand page; no membership system exists |

`pages/course.html` (course detail) and `404.html` use the same shell. Its
header marks **Courses** active; `404.html` marks nothing.

**Shared shell — `assets/css/public.css`.** One header (`.pub-header`) and
footer (`.pub-footer`) for every public page, plus the content-page kit
(`.pub-hero`, `.pub-section`, `.pub-card`, `.pub-cta-panel`, ...). Page-specific
CSS is loaded after it: `home.css`, `about.css` (About + Contact),
`testimonials.css`, `one-percent.css`.

**Header markup contract.** `nav.js` binds to `[data-site-nav]`,
`[data-nav-toggle]` and `.nav-actions` — keep those hooks. Auth is unchanged:
guests see *Get Started* + *Login*, signed-in users see *Dashboard*. My Learning,
My Orders and Sign out belong to the student shell, not the public header.

**Active page** is written statically as `aria-current="page"` on the matching
link in each file (header and footer). No JavaScript decides it. When adding a
page, add it to the six-link list in **every** public file.

**Relative paths.** `index.html` and `404.html` live at the root, so links are
`pages/x.html`; everything under `pages/` uses `x.html` and `../index.html`.
Never root-relative (`/pages/...`) in `href`; only `<link rel="canonical">`
uses root-relative paths, matching the existing convention.

**Header breakpoint is 1100px.** Six links plus two CTAs only fit on one line
above that, so the collapsed menu takes over at `max-width: 1100px` (not the
860px used by `site.css`, which the auth and learn shells still rely on).

**Testimonials.** No testimonials endpoint exists in the API contract, so the
page shows an empty state and makes no network call. When real data exists,
render `.tm-card` elements into `#stories-grid`, unhide it, and hide
`#stories-empty` (markup contract is in a comment in the HTML). Emit optional
parts (avatar, role, course) only when the value exists.

## API configuration

All backend calls go through `assets/js/config.js`, which resolves
`API_BASE_URL` based on hostname (localhost vs. production). Never hardcode
API URLs elsewhere in the codebase.

## What this app must NEVER contain

- MongoDB connection strings or credentials
- JWT secrets
- Razorpay secret key
- Bunny.net API key
- Any other backend-only secret

This app talks to the backend **only** over HTTPS API calls.

## Design system

White-dominant surface with a purple accent (`--color-accent-500`). All
colors, spacing, radius, and shadows are defined as CSS custom properties in
`assets/css/tokens.css` — reference tokens rather than hardcoding values.

## Authentication (Phase 2)

Login is **User ID + password**. There is no email anywhere.

**No token is ever visible to JavaScript.** The backend sets two HttpOnly
cookies; this app only sends `credentials: 'include'`. The single thing kept
in `localStorage` is the boolean hint `tnc_signed_in`, used only to skip a
pointless network call for first-time visitors. It grants nothing: forging or
deleting it changes no access, because the server decides on every request.
The user profile lives in memory only and is re-fetched from `GET /auth/me`.

- `api.js` adds `X-Requested-With: XMLHttpRequest` to every non-GET request
  (the backend's CSRF check rejects requests without it), throws `ApiError`
  carrying `status`, `errorCode` and per-field `errors`, and on a 401 makes
  ONE shared silent `/auth/refresh` then retries once. Auth endpoints
  themselves are never refreshed-and-retried.
- **Protected pages:** put this at the top of the page script:

  ```js
  const user = await Auth.requireAuth(); // redirects to login if not signed in
  ```

  and add `html.auth-pending body{visibility:hidden}` (see `dashboard.html`)
  so protected UI never flashes. This controls **navigation only**; real
  protection is the backend authenticating each API call.
- After login, `?next=` is honoured only for same-site relative paths
  (`Auth.safeNext`), so the login page cannot be used as an open redirector.
- All user/API text is written with `textContent`, not `innerHTML`.

## Deployment note

Edit the production URL in `assets/js/config.js`. The site's exact origin
must be set as `PUBLIC_WEBSITE_URL` on the backend, and both must be served
over HTTPS if they are on different sites. See `backend/README.md` →
"Cross-origin cookie deployment".
