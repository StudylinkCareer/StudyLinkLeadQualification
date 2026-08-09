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
//   4. Per lead (student_id), the first non-KBM call EVER (checked
//      against full history, not just the reporting period) = New.
//      Every later non-KBM call = Ongoing.
//   5. Ongoing is deduped by (student_id, VN calendar day, khung giờ
//      time-slot) — repeat non-KBM calls to the same lead in the same
//      slot count once; a different slot (even the same day) counts as
//      a separate Ongoing touch. Replaces the earlier "4-hour rolling
//      window" idea with the same 3 slots the Uncontactable-transfer
//      feature uses.
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
 *   least { student_id, full_name, contact_platform, content, created_at,
 *   call_answered }.
 * @param {Array} historyNotes Notes from BEFORE the window (any author,
 *   any time) — used only to decide whether a period note is that lead's
 *   first-ever non-KBM contact. Same shape as periodNotes.
 * @returns {{
 *   newItems: Array, ongoingItems: Array, kbmItems: Array,
 *   newCount: number, ongoingCount: number, kbmCount: number, totalCount: number,
 * }}
 */
function classifyCalls(periodNotes, historyNotes = []) {
  // Earliest non-KBM contact time per lead, from history alone — so a
  // second in-period contact never gets misclassified as "New".
  const firstEverMs = new Map();
  for (const n of historyNotes) {
    if (!isCallNote(n) || classifyKbm(n)) continue;
    const t = new Date(n.created_at).getTime();
    const cur = firstEverMs.get(n.student_id);
    if (cur == null || t < cur) firstEverMs.set(n.student_id, t);
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
  const seenOngoingKey = new Set();     // `${studentId}|${dayKey}|${slot}`
  const newAlreadyGiven = new Set();    // studentId — only one New per lead per period

  for (const n of nonKbm) {
    const t = new Date(n.created_at).getTime();
    const hasPriorContact = firstEverMs.has(n.student_id);
    if (!hasPriorContact && !newAlreadyGiven.has(n.student_id)) {
      newAlreadyGiven.add(n.student_id);
      newItems.push({ studentId: n.student_id, fullName: n.full_name, note: n });
      continue;
    }
    const dayKey = vnDateKey(t);
    const slot = slotOf(t);
    const key = `${n.student_id}|${dayKey}|${slot}`;
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

module.exports = { classifyCalls, isCallNote, classifyKbm };
