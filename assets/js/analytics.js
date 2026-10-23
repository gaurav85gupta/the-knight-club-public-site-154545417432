/* Google Analytics 4 loader.
 * Does nothing until a real Measurement ID is set below
 * (create one free at analytics.google.com, then paste e.g. 'G-AB12CD34EF').
 * One place to edit — no need to touch every page. */
(function () {
  var GA_ID = '';
  if (!/^G-[A-Z0-9]{6,}$/.test(GA_ID)) return;
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID);
})();
