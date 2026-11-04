/* Founder card scroll-in animation (home + about).
   Adds .is-visible once the card enters the viewport so its entrance
   animation (defined in public.css, .founder-v2-card.is-visible) plays
   only when the visitor actually scrolls to it, not on page load while
   it's still off-screen. No-op, fully visible card if JS never runs. */
(function () {
  var card = document.querySelector(".founder-v2-card");
  if (!card) return;

  if (!("IntersectionObserver" in window)) {
    card.classList.add("is-visible");
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          card.classList.add("is-visible");
          observer.disconnect();
        }
      });
    },
    { threshold: 0.15 }
  );
  observer.observe(card);

  /* Safety net: on very short viewports the 0.15 threshold can be missed
     (e.g. a tall card on a short screen never reaches 15% visible even
     while on-screen). If nothing has triggered the class after a beat,
     reveal the card anyway so it can never get stuck invisible. */
  window.setTimeout(function () {
    card.classList.add("is-visible");
  }, 1500);
})();