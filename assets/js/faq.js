/* ==========================================================================
   THE KNIGHT CLUB — Global FAQ accordion  (the ONLY accordion script)
   --------------------------------------------------------------------------
   Styles: assets/css/faq.css  (markup contract is documented at its bottom).

   - Real <button aria-expanded aria-controls>; Enter / Space come for free.
   - ids, aria-controls and aria-labelledby are generated when missing, so a
     content editor only has to add a .faq-item block — nothing to renumber
     or re-wire (numbers are a CSS counter).
   - Default behaviour = every item toggles independently (what the old
     <details> FAQs did). Add `data-faq-single` to a .faq-list to make it
     one-open-at-a-time.
   - Opening a #hash that points at an item (or its question / answer) opens it.
   - Public API: window.initFAQs(root?)  — idempotent, safe to call again
     after injecting FAQ markup dynamically.
   ========================================================================== */
(function () {
  'use strict';

  var uid = 0;

  function setOpen(item, open) {
    var btn = item.querySelector('.faq-question');
    if (!btn) return;
    item.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function wire(item, listIndex, itemIndex) {
    var btn = item.querySelector('.faq-question');
    var panel = item.querySelector('.faq-answer');
    if (!btn || !panel) return;

    var key = listIndex + '-' + itemIndex;
    if (!btn.id)   btn.id   = 'faq-q-' + key;
    if (!panel.id) panel.id = 'faq-a-' + key;
    btn.setAttribute('aria-controls', panel.id);
    panel.setAttribute('aria-labelledby', btn.id);
    if (!panel.hasAttribute('role')) panel.setAttribute('role', 'region');
    if (btn.getAttribute('type') !== 'button') btn.setAttribute('type', 'button');

    // Authoring may pre-open an item with .is-open or aria-expanded="true".
    var startOpen = item.classList.contains('is-open') ||
                    btn.getAttribute('aria-expanded') === 'true';
    setOpen(item, startOpen);
  }

  function openFromHash(list) {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    var target;
    try { target = list.querySelector('#' + CSS.escape(hash.slice(1))); } catch (e) { return; }
    var item = target && target.closest('.faq-item');
    if (item && list.contains(item)) setOpen(item, true);
  }

  function initList(list) {
    if (list.getAttribute('data-faq-ready') === 'true') return;
    var index = ++uid;
    var single = list.hasAttribute('data-faq-single');
    var items = list.querySelectorAll('.faq-item');

    for (var i = 0; i < items.length; i++) wire(items[i], index, i + 1);

    list.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.faq-question') : null;
      if (!btn || !list.contains(btn)) return;
      var item = btn.closest('.faq-item');
      var willOpen = btn.getAttribute('aria-expanded') !== 'true';
      if (single && willOpen) {
        var open = list.querySelectorAll('.faq-item.is-open');
        for (var j = 0; j < open.length; j++) if (open[j] !== item) setOpen(open[j], false);
      }
      setOpen(item, willOpen);
    });

    openFromHash(list);
    list.setAttribute('data-faq-ready', 'true');
  }

  function initFAQs(root) {
    var scope = root || document;
    var lists = scope.querySelectorAll('[data-faq]');
    for (var i = 0; i < lists.length; i++) initList(lists[i]);
  }

  window.initFAQs = initFAQs;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initFAQs(); });
  } else {
    initFAQs();
  }

  window.addEventListener('hashchange', function () {
    var lists = document.querySelectorAll('[data-faq]');
    for (var i = 0; i < lists.length; i++) openFromHash(lists[i]);
  });
})();
