// shared/site-config.js
// -----------------------------------------------------------------------------
// Maps browser URLs to Solid Pod folder categories.
// Each rule is evaluated in order; the first match wins.
// Add new entries here when you onboard additional partner sites.
// -----------------------------------------------------------------------------

/**
 * @typedef {{ label: string, match: (url: URL) => boolean, category: string }} SiteRule
 */

/** @type {SiteRule[]} */
export const SITE_RULES = [
  // ── Local Angular dev server (localhost:4200) ─────────────────────────────
  {
    label:    'BEKB',
    match:    (url) => url.hostname === 'localhost' && url.port === '4200'
                       && url.pathname.startsWith('/bekb'),
    category: 'bekb',
  },
  {
    label:    'TaxMe',
    match:    (url) => url.hostname === 'localhost' && url.port === '4200'
                       && url.pathname.startsWith('/taxme'),
    category: 'taxme',
  },

  // ── Production domains ────────────────────────────────────────────────────
  {
    label:    'BEKB',
    match:    (url) => url.hostname === 'bekb.ch' || url.hostname.endsWith('.bekb.ch'),
    category: 'bekb',
  },
  {
    label:    'TaxMe',
    match:    (url) => url.hostname === 'taxme.ch' || url.hostname.endsWith('.taxme.ch'),
    category: 'taxme',
  },
];

/**
 * All known Pod categories — used for "show all" mode.
 * Keep in sync with SITE_RULES above.
 */
export const ALL_CATEGORIES = ['bekb', 'taxme', 'inbox'];

/**
 * Returns the Pod category for a given page URL, or null if the site is unknown.
 *
 * @param {string} urlString
 * @returns {{ category: string, label: string } | null}
 */
export function getSiteContext(urlString) {
  try {
    const url = new URL(urlString);
    const rule = SITE_RULES.find(r => r.match(url));
    return rule ? { category: rule.category, label: rule.label } : null;
  } catch (_) {
    return null;
  }
}
