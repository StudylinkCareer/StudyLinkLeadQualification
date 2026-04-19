// src/utils/stoneLabels.js
// -----------------------------------------------------------------------------
// Central source of truth for stone-tier values and translated labels.
// Stone tiers (Diamond, Ruby, Sapphire, Agate, Quartz, Unscored) are canonical
// English strings stored in the DB. This file maps them to translated display
// labels, following the same pattern as leadStatusLabels.js.
// -----------------------------------------------------------------------------

export const STONE_TIERS = [
  'Diamond',
  'Ruby',
  'Sapphire',
  'Agate',
  'Quartz',
  'Unscored',
];

export const STONE_LABELS = {
  en: {
    'Diamond':  'Diamond',
    'Ruby':     'Ruby',
    'Sapphire': 'Sapphire',
    'Agate':    'Agate',
    'Quartz':   'Quartz',
    'Unscored': 'Unscored',
  },
  vi: {
    'Diamond':  'Kim cương',
    'Ruby':     'Hồng ngọc',
    'Sapphire': 'Lam ngọc',
    'Agate':    'Mã não',
    'Quartz':   'Thạch anh',
    'Unscored': 'Chưa chấm điểm',
  },
};

/**
 * Return a translated label for a stone tier.
 * Falls back to the original value if no translation exists.
 *
 * @param {string} tier     - canonical English value (e.g. 'Diamond')
 * @param {string} language - 'en' or 'vi'
 * @returns {string} translated label
 */
export function stoneLabel(tier, language = 'en') {
  if (!tier) return tier;
  return STONE_LABELS[language]?.[tier] || tier;
}
