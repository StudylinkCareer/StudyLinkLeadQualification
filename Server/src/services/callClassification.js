// Server/src/services/callClassification.js
// ─────────────────────────────────────────────────────────────────────
// Unified New / Ongoing / KBM call classification — the single definition
// shared by Weekly Report and Monthly Report so the two agree with each
// other (confirmed 2026-08, replaces each report's own ad-hoc counting).
//
// Rule:
//   1. A "call" = isCallNote(note) — contact_platform set OR content
//      mentions a phone/call keyword (same rule already used everywhere).
//   2. KBM = classifyKbm(note), among call-notes only (explicit
//      call_answered toggle always wins; falls back to scanning the text
//      for unanswered-call phrasing only when the toggle was never used).
//   3. KBM notes are REMOVED from the pool before New/Ongoing
//      classification — a KBM'd attempt never counts as anyone's "first
//      contact", and never gets mislabeled as a successful touch.
//   4. New is scoped PER STAFF MEMBER, not per lead globally (revised
//      2026-08): for a given (student_id, author_name) pair, the first
//      non-KBM call THAT STAFF MEMBER has ever made to that lead (checked
//      against full history, not just the reporting period) = New for
//      them. Every later non-KBM call BY THE SAME STAFF MEMBER to the
//      same lead = Ongoing. A lead handed off between phases/counselors
//      (e.g. Presales -> Counselor) is legitimately "New" again for the
//      counselor receiving it, even though Presales already made first
//      contact — New/Ongoing answers "is this new to ME", not "has
//      anyone ever reached this person." (Previously scoped per lead
//      only, so a lead that already had any history — usually from
//      Presales doing its job — could never register as New again for
//      whoever it was handed to next.)
//   5. Ongoing is deduped by (student_id, author_name, VN calendar day,
//      khung giờ time-slot) — repeat non-KBM calls BY THE SAME STAFF
//      MEMBER to the same lead in the same slot count once; a different
//      slot (even the same day), or the same slot touched by a DIFFERENT
//      staff member (e.g. a hand-off day), each count separately.
//      Replaces the earlier "4-hour rolling window" idea with the same 3
//      slots the Uncontactable-transfer feature uses.
//   6. Cuộc gọi (Total) = New + Ongoing. KBM is never subtracted a
//      second time — it was already excluded from both buckets in step 3.
// ─────────────────────────────────────────────────────────────────────
const { containsPhoneMention, containsUnansweredMention } = require('./phoneAliases');
const { slotOf, vnDateKey } = require('./callSlots');

function isCallNote(n) {
  return (n.contact_platform != null && n.contact_platform !== '') || containsPhoneMention(n.content);
}

function classifyKbm(n) {
  if (n.call_answered === false) return 'toggle';
  if (n.call_answered === true) return null;
  return containsUnansweredMention(n.content) ? 'keyword' : null;
}

/**
 * @param {Array} periodNotes  Notes in the reporting window. Each needs at
 *   least { student_id, author_name, full_name, contact_platform, content,
 *   created_at, call_answered }.
 * @param {Array} historyNotes Notes from BEFORE the window (any author,
 *   any time) — used only to decide whether a period note is THAT STAFF
 *   MEMBER's first-ever non-KBM contact with that lead. Same shape as
 *   periodNotes; must include author_name for the per-staff scoping to
 *   work (a row missing it just never registers as anyone's history).
 * @returns {{
 *   newItems: Array, ongoingItems: Array, kbmItems: Array,
 *   newCount: number, ongoingCount: number, kbmCount: number, totalCount: number,
 * }}
 */
function classifyCalls(periodNotes, historyNotes = []) {
  // Earliest non-KBM contact time per (lead, staff member), from history
  // alone — so a second in-period contact never gets misclassified as
  // "New". Keyed by author, not just lead: New answers "is this new to
  // ME", so a lead already worked by someone else (typically Presales,
  // before a hand-off) is still legitimately New for the next person.
  const firstEverMs = new Map();
  for (const n of historyNotes) {
    if (!n.author_name || !isCallNote(n) || classifyKbm(n)) continue;
    const t = new Date(n.created_at).getTime();
    const key = `${n.student_id}|${n.author_name}`;
    const cur = firstEverMs.get(key);
    if (cur == null || t < cur) firstEverMs.set(key, t);
  }

  // Sort chronologically so within-period "who gets New" resolution is
  // stable regardless of the caller's row order.
  const sorted = periodNotes.filter(isCallNote)
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const kbmItems = [];
  const nonKbm = [];
  for (const n of sorted) {
    const kbmSource = classifyKbm(n);
    if (kbmSource) { kbmItems.push({ studentId: n.student_id, fullName: n.full_name, note: n, kbmSource }); continue; }
    nonKbm.push(n);
  }

  const newItems = [];
  const ongoingItems = [];
  const seenOngoingKey = new Set();     // `${studentId}|${authorName}|${dayKey}|${slot}`
  const newAlreadyGiven = new Set();    // `${studentId}|${authorName}` — only one New per (lead, staffer) per period

  for (const n of nonKbm) {
    const t = new Date(n.created_at).getTime();
    const ownKey = `${n.student_id}|${n.author_name}`;
    const hasPriorContact = firstEverMs.has(ownKey);
    if (!hasPriorContact && !newAlreadyGiven.has(ownKey)) {
      newAlreadyGiven.add(ownKey);
      newItems.push({ studentId: n.student_id, fullName: n.full_name, note: n });
      continue;
    }
    const dayKey = vnDateKey(t);
    const slot = slotOf(t);
    const key = `${ownKey}|${dayKey}|${slot}`;
    if (seenOngoingKey.has(key)) continue;
    seenOngoingKey.add(key);
    ongoingItems.push({ studentId: n.student_id, fullName: n.full_name, note: n, slot, dayKey });
  }

  return {
    newItems, ongoingItems, kbmItems,
    newCount: newItems.length,
    ongoingCount: ongoingItems.length,
    kbmCount: kbmItems.length,
    totalCount: newItems.length + ongoingItems.length,
  };
}

// Normalise a stored contact_platform into one of six communication modes.
// Shared by Weekly Report (computeGroup) and Individual/Company Report
// (rangeReport.js) so a "by platform / by mode" breakdown always collapses
// the same way in both places — moved here 2026-09 after a real report bug:
// rangeReport.js was using the raw contact_platform string directly instead
// of this normalization, so an explicit "Phone Call" note (the exact label
// LeadDetail.jsx's CONTACT_LABELS stores when a staffer picks that method)
// and a null-platform call note (which falls back to the string literal
// below) landed in two different map keys — 'Phone Call' vs 'Phone call' —
// and showed up as two separate columns for what's really one mode.
// Keyword-only call mentions (no platform) are treated as Phone call upstream.
function normalizeMode(platform) {
  const p = String(platform || '').toLowerCase();
  if (p.includes('mail'))                                return 'E-mail';
  if (p.includes('phone') || p.includes('call'))          return 'Phone call';
  if (p.includes('sms') || p.includes('text'))            return 'SMS';
  if (p.includes('zalo'))                                 return 'Zalo';
  if (p.includes('whatsapp'))                             return 'WhatsApp';
  if (p.includes('messenger') || p.includes('facebook'))  return 'Messenger';
  return platform || 'Phone call';
}

module.exports = { classifyCalls, isCallNote, classifyKbm, normalizeMode };
