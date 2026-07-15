// Client/src/utils/stoneGlyphs.js
// ---------------------------------------------------------------------
// Flat, vector gem glyphs — one per stone tier — for the QR badge centre.
// Photographic stone images don't miniaturise well inside a QR code, so the
// badge uses these logo-style glyphs instead (same treatment as the StudyLink
// logo: white centre hole, hideBackgroundDots). The photographic stones stay
// on the large surfaces (e-mail banner, thank-you card, roster icon).
// Duplicated in LeadManagement/src/utils/stoneGlyphs.js — keep in sync.
// ---------------------------------------------------------------------

// Brilliant-cut silhouette: crown (three facets) over pavilion (three facets).
const FACETS = [
  '30,12 70,12 65,38 35,38',  // crown table
  '30,12 8,38 35,38',         // crown left
  '70,12 92,38 65,38',        // crown right
  '8,38 35,38 50,88',         // pavilion left
  '35,38 65,38 50,88',        // pavilion centre
  '65,38 92,38 50,88',        // pavilion right
];

// One colour per facet, per tier — light table, darker flanks.
const PALETTES = {
  Quartz:   ['#e2e8f0', '#cbd5e1', '#94a3b8', '#b6c2d1', '#dbe4ee', '#8fa3b8'],
  Agate:    ['#fdba74', '#f97316', '#c2410c', '#ea580c', '#fb923c', '#9a3412'],
  Sapphire: ['#93c5fd', '#3b82f6', '#1d4ed8', '#2563eb', '#60a5fa', '#1e40af'],
  Ruby:     ['#fca5a5', '#ef4444', '#b91c1c', '#dc2626', '#f87171', '#991b1b'],
  Diamond:  ['#bae6fd', '#7dd3fc', '#38bdf8', '#7cc4ef', '#d4ecfb', '#5aa9dd'],
};

function glyphDataUrl(colors) {
  const polys = FACETS.map((pts, i) => `<polygon points="${pts}" fill="${colors[i]}"/>`).join('');
  // Explicit width/height so canvas drawImage sizes the SVG correctly.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 100 100">${polys}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export const STONE_GLYPHS = Object.fromEntries(
  Object.entries(PALETTES).map(([tier, colors]) => [tier, glyphDataUrl(colors)])
);
