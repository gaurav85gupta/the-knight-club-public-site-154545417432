# Student Day / Night theme — notes & test checklist

## What changed
NEW   assets/js/theme-init.js      blocking <head> script: sets <html data-theme>, no flash, localStorage `tnc_theme`
NEW   assets/js/theme-toggle.js    the sun/moon button (one implementation)
NEW   assets/css/student-theme.css ALL tokens (dark + light) + overrides + toggle + transitions
EDIT  assets/js/student-shell.js   toggle in desktop header + mobile drawer ("Appearance" row)
EDIT  assets/js/learn.js           mounts toggle in learn header (3 lines)
EDIT  pages/{dashboard,learning,orders,order-detail,profile,settings,change-password,learn}.html
      -> +theme-init.js (head), +student-theme.css (last CSS), +theme-toggle.js
Public pages, tokens.css, theme.css, student.css, learn.css, orders.css, auth.css: UNTOUCHED.

## Design
- Default = Night (existing look). No saved pref -> dark.
- Public site never loads theme-init.js -> <html> has no data-theme -> every rule is inert.
- Night rules fall through to the original CSS wherever possible (drifting overrides are Day-only).
- Day contrast checked numerically (WCAG): text 16:1, muted 6.3:1, white-on-button 5.7-7.1:1,
  input border 3.4:1, placeholder 5:1, status text >=4.85:1 on their pills.

## NOT applicable in this codebase
Cart and Checkout pages do not exist (payment = Razorpay popup on public pages/course.html).
course.html is a PUBLIC page and was intentionally not themed.

## NOT TESTED YET — please check
[ ] Toggle works on all 8 pages; icon = sun in Night, moon in Day
[ ] Refresh / navigate between pages keeps theme; no flash on reload (try Day + hard refresh)
[ ] Sign out -> login -> theme still remembered
[ ] Day mode: anything still dark? (cards, sidebar, dropdown, drawer, skeletons, empty/error states, toasts)
[ ] Night mode looks identical to before
[ ] learn.html: video plays, fullscreen works, sidebar states (current/completed/locked) readable in both
[ ] Mobile 375/390/414/768: header, drawer "Appearance" toggle, no horizontal scroll
[ ] Keyboard: Tab to toggle, Enter/Space works, focus ring visible; screen-reader label flips
[ ] Public pages (/, courses, about...) look exactly as before
[ ] Password autofill colors, checkbox/select look right

## Known caveats
- Brand text in code is "The Knight Club" (spec says "Night Club"); left as-is.
- .theme-transition adds a 320ms colour fade only on manual switch.
