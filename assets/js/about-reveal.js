/* About page — section scroll-reveal.
   Adds .is-visible to each .ab-reveal element once it enters the
   viewport (same IntersectionObserver convention as founder-card.js
   and one-percent.js's .is-visible usage). Progressive enhancement:
   content is fully visible via about.css if this script never runs. */
(function () {
  var items = document.querySelectorAll(".ab-reveal");
  if (!items.length) return;

  if (!("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("is-visible"); });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );

  items.forEach(function (el) { observer.observe(el); });

  /* Safety net: reveal anything still hidden after a beat, same pattern
     as founder-card.js, so nothing gets stuck invisible. */
  window.setTimeout(function () {
    items.forEach(function (el) { el.classList.add("is-visible"); });
  }, 2500);
})();
