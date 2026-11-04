# Hero Countdown — Public Frontend Changes

Premium digit-box countdown timer in the 1% Club hero section, fully
driven by the plan API response. No date, label, or "limited time"
copy is hardcoded anywhere in this frontend.

## Files changed

- `pages/one-percent-club.html`
  - New markup block right after `.oc-price-pill` in the hero:
    `data-oc-countdown` wrapper, `data-oc-countdown-label`,
    4 digit boxes (`data-oc-cd-days/hours/minutes/seconds`), and an
    `data-oc-countdown-expired` message slot. `hidden` by default so
    the page never flashes a countdown before the plan loads.

- `assets/js/one-percent.js`
  - `updateCountdown()` — called from `updatePageMeta()` once the plan
    loads. Reads `plan.countdown` (`{enabled, label, endsAt,
    expiredText}`) from the API response.
    - `enabled: false` → the whole block stays hidden.
    - `enabled: true` → shows the block, starts a 1-second
      `setInterval` tick, re-renders Days/Hrs/Min/Sec live.
    - On reaching zero: shows `expiredText` if one is configured,
      otherwise hides the block.
  - Uses one shared interval handle so re-renders never stack timers.

- `assets/css/one-percent.css`
  - New `.oc-countdown*` rules: glass + gold digit boxes matching the
    existing price-pill and flagship-badge styling, a pulsing-dot label,
    light-theme overrides, and mobile sizing in the existing
    `@media (max-width:640px)` / `@media (max-width:480px)` blocks.
  - No new `<link>` needed — `one-percent.css` is already loaded by
    this page.

## Nothing to configure here

This frontend has zero hardcoded dates or copy for the countdown. All
of it — whether it shows at all, the label text, the deadline, and the
expired message — comes from the Super Admin panel (see
`super-admin/COUNTDOWN_CHANGES.md`).
