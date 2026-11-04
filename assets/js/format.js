/**
 * Format — small display helpers for public catalog pages.
 *
 * Prices arrive from the API as INTEGER MINOR UNITS (paise for INR — see
 * backend/src/utils/money.js). This file is the ONLY place that converts
 * minor -> major units for display; nothing else should hand-divide by 100.
 */

const Format = (() => {
  const CURRENCY_SYMBOL = { INR: '₹' };

  /** @param {{basePrice:number, salePrice:number, currency:string, isFree:boolean}|null} pricing */
  function price(pricing) {
    if (!pricing) return '';
    const symbol = CURRENCY_SYMBOL[pricing.currency] || `${pricing.currency} `;
    if (pricing.isFree) return 'Free';
    const major = (pricing.salePrice / 100).toLocaleString('en-IN', {
      maximumFractionDigits: pricing.salePrice % 100 === 0 ? 0 : 2,
    });
    return `${symbol}${major}`;
  }

  /** Original (base) price, for a strikethrough next to a discounted price. Empty string if no discount. */
  function originalPrice(pricing) {
    if (!pricing || pricing.isFree) return '';
    if (pricing.basePrice <= pricing.salePrice) return '';
    const symbol = CURRENCY_SYMBOL[pricing.currency] || `${pricing.currency} `;
    const major = (pricing.basePrice / 100).toLocaleString('en-IN', {
      maximumFractionDigits: pricing.basePrice % 100 === 0 ? 0 : 2,
    });
    return `${symbol}${major}`;
  }

  function durationFromMinutes(mins) {
    const n = Number(mins) || 0;
    if (n <= 0) return '';
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function durationFromSeconds(secs) {
    const n = Number(secs) || 0;
    if (n <= 0) return '';
    const totalMinutes = Math.round(n / 60);
    if (totalMinutes < 1) return '<1m';
    return durationFromMinutes(totalMinutes);
  }

  const LEVEL_LABELS = {
    BEGINNER: 'Beginner',
    INTERMEDIATE: 'Intermediate',
    ADVANCED: 'Advanced',
    ALL_LEVELS: 'All levels',
  };

  function level(v) {
    return LEVEL_LABELS[v] || '';
  }

  /** Escapes text for safe insertion when building strings with innerHTML (used sparingly). */
  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function truncate(str, max) {
    const s = String(str || '');
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1).trimEnd()}…`;
  }

  return { price, originalPrice, durationFromMinutes, durationFromSeconds, level, escapeHtml, truncate };
})();
