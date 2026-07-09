// LeadManagement/src/utils/phoneAliases.js
//
// Client-side MIRROR of Server/src/services/phoneAliases.js. Detects whether a
// free-text note mentions a phone call, using the SAME alias list + matching
// rules the Activity Report uses server-side, so the per-lead notes "Phone
// calls" filter classifies notes identically.
//
// If you change the alias list, change it in BOTH files.

const ENGLISH_ALIASES = [
  'phone', 'phoned', 'phoning', 'call', 'called', 'calling', 'calls',
  'voicemail', 'voice mail', 'rang', 'telephone', 'dialed', 'dialled',
];

const VIETNAMESE_ALIASES = [
  'điện thoại', 'gọi', 'gọi điện', 'cuộc gọi', 'alo', 'đã gọi',
];

function stripDiacritics(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function buildAliasList() {
  const out = new Set();
  for (const word of [...ENGLISH_ALIASES, ...VIETNAMESE_ALIASES]) {
    const lower = word.toLowerCase();
    out.add(lower);
    out.add(stripDiacritics(lower));
  }
  return [...out];
}

const ALIASES = buildAliasList();

function buildAliasRegex() {
  const escaped = ALIASES.map(a =>
    a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  );
  escaped.sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

const ALIAS_REGEX = buildAliasRegex();

// Returns true if the given note text contains any phone-related alias.
export function containsPhoneMention(text) {
  if (!text || typeof text !== 'string') return false;
  const lower    = text.toLowerCase();
  const stripped = stripDiacritics(lower);
  return ALIAS_REGEX.test(lower) || ALIAS_REGEX.test(stripped);
}
