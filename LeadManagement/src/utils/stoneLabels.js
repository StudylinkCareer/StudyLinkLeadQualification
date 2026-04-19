// src/utils/stoneLabels.js
// -----------------------------------------------------------------------------
// Central source of truth for stone-tier values and translated labels.
// Stone tiers (Diamond, Ruby, Sapphire, Agate, Quartz, Unscored) are canonical
// English strings stored in the DB. This file maps them to translated display
// labels.
//
// The Vietnamese translations below match the canonical names used in the
// Lead Qualification app (client/src/i18n/vi.js, 'stone_*' keys). If the LQ
// canonical names ever change, update this file to match.
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
    'Diamond':  'Kim Cương',
    'Ruby':     'Hồng Ngọc',
    'Sapphire': 'Ngọc Bích',
    'Agate':    'Mã Não',
    'Quartz':   'Thạch Anh',
    'Unscored': 'Chưa chấm điểm',
  },
};

/**
 * Return a translated label for a stone tier.
 * Falls back to the original value if no translation exists.
 */
export function stoneLabel(tier, language = 'en') {
  if (!tier) return tier;
  return STONE_LABELS[language]?.[tier] || tier;
}
