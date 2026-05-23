// server/src/services/phoneAliases.js
//
// PURPOSE
//   Detect whether a free-text note mentions a phone call.
//   Used by the Activity Report aggregation. Phone notes count separately
//   from other notes so managers can see who's actually calling vs writing.
//
// MATCHING RULES
//   - Case-insensitive
//   - Diacritic-stripped (so "gọi" matches a note containing "goi")
//   - Whole-word boundaries on Latin words to avoid false positives
//     (e.g. "call" must not match "called back" — wait, that should match —
//      but it must NOT match "scallop"). Word boundary handles that.
//   - Multi-word phrases (e.g. "điện thoại") are matched as literal sequences
//     with whitespace flexibility.
//
// PERFORMANCE
//   Notes are matched in JavaScript after Postgres returns them. This
//   keeps the SQL simple and lets us iterate on the alias list without
//   schema/index changes. For ~10,000 notes it's a few ms total.
//
// EDITING THE LIST
//   This is the only place that defines what "phone" means. Adjust the
//   arrays below as needed; no other code needs to change.

// English forms of phone/call
const ENGLISH_ALIASES = [
  'phone',
  'phoned',
  'phoning',
  'call',
  'called',
  'calling',
  'calls',
  'voicemail',
  'voice mail',
  'rang',
  'telephone',
  'dialed',
  'dialled',
];

// Vietnamese forms (diacritic-aware; we ALSO add diacritic-stripped
// versions automatically below).
const VIETNAMESE_ALIASES = [
  'điện thoại',
  'gọi',
  'gọi điện',
  'cuộc gọi',
  'alo',
  'đã gọi',
];

// Strip Vietnamese (and general) diacritics from a string. Used to make
// matching insensitive to whether the note-writer typed accents or not.
function stripDiacritics(s) {
  return s
    .normalize('NFD')                 // split base char + combining marks
    .replace(/[\u0300-\u036f]/g, '')   // remove combining marks
    .replace(/đ/g, 'd')                // Vietnamese 'đ' isn't a diacritic combo
    .replace(/Đ/g, 'D');
}

// Build the full alias list — original + diacritic-stripped versions,
// de-duplicated, lowercased.
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

// Build a single regex that matches any alias.
//   - \b boundaries on each alias prevent partial-word matches
//     ("call" won't match inside "scallop", but WILL match "call." or "call,")
//   - Multi-word aliases (e.g. "điện thoại") allow flexible whitespace
//   - 'i' flag = case-insensitive
//   - Aliases are escaped for regex safety
function buildAliasRegex() {
  const escaped = ALIASES.map(a =>
    a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
     .replace(/\s+/g, '\\s+')         // allow flexible whitespace
  );
  // Sort longest-first so multi-word aliases match before their constituent
  // single-word aliases. Otherwise "gọi" would match inside "gọi điện" first
  // and the second word wouldn't be considered.
  escaped.sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

const ALIAS_REGEX = buildAliasRegex();

/**
 * Returns true if the given note text contains any phone-related alias.
 * Handles null/undefined safely (returns false).
 *
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
function containsPhoneMention(text) {
  if (!text || typeof text !== 'string') return false;
  // Test both the raw text and its diacritic-stripped version, so
  // notes written with or without Vietnamese accents both match.
  const lower    = text.toLowerCase();
  const stripped = stripDiacritics(lower);
  return ALIAS_REGEX.test(lower) || ALIAS_REGEX.test(stripped);
}

module.exports = {
  containsPhoneMention,
  // exported for testing / debugging only — not used by the controller
  _aliases: ALIASES,
  _regex:   ALIAS_REGEX,
};
