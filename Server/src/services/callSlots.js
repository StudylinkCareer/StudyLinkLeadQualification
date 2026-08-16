// Server/src/services/callSlots.js
// ─────────────────────────────────────────────────────────────────────
// "Khung giờ" (time-slot) classification, VN local time. Shared by:
//   - callClassification.js (New/Ongoing dedup key: lead + day + slot,
//     replacing the earlier "4-hour rolling window" idea)
//   - The Uncontactable → Pre-sales auto-transfer feature (needs 3
//     KBM calls covering 3 DISTINCT slots before it qualifies)
//
// Slot 1: 08:00–12:00, Mon–Sat
// Slot 2: 13:30–17:30, Mon–Fri
// Slot 3: everything else (Sun all day, Sat afternoon/evening, every
//         night, early mornings, etc.)
//
// Confirmed 2026-08 (StudyLink) — see the calls-counting-unification /
// Uncontactable-transfer conversation for the full reasoning.
// ─────────────────────────────────────────────────────────────────────

const VN_MS = 7 * 60 * 60 * 1000;

// VN-local { dow, hm } for a Date/timestamp/ms. dow: 0=Sun..6=Sat.
// hm: minutes since VN-local midnight.
function vnParts(dateOrMs) {
  const ms = dateOrMs instanceof Date ? dateOrMs.getTime() : new Date(dateOrMs).getTime();
  const vn = new Date(ms + VN_MS);
  return {
    dow: vn.getUTCDay(),
    hm: vn.getUTCHours() * 60 + vn.getUTCMinutes(),
  };
}

// VN calendar date (YYYY-MM-DD) — the "day" half of the slot dedup key.
function vnDateKey(dateOrMs) {
  const ms = dateOrMs instanceof Date ? dateOrMs.getTime() : new Date(dateOrMs).getTime();
  return new Date(ms + VN_MS).toISOString().slice(0, 10);
}

// Returns 1 | 2 | 3 — see the header comment for the slot definitions.
function slotOf(dateOrMs) {
  const { dow, hm } = vnParts(dateOrMs);
  const isMonSat = dow >= 1 && dow <= 6;   // Mon(1)..Sat(6)
  const isMonFri = dow >= 1 && dow <= 5;   // Mon(1)..Fri(5)
  if (isMonSat && hm >= 8 * 60 && hm < 12 * 60) return 1;
  if (isMonFri && hm >= 13 * 60 + 30 && hm < 17 * 60 + 30) return 2;
  return 3;
}

// ── Evening telesales "3 different khung giờ" rule ──────────────────────────
// Some Pre-sales staff (confirmed 2026-08: Phan Bùi Giang Thanh, Trần Thị
// Huyền Trang) only call in the evening, every day — the fixed 3-slot system
// above doesn't apply to them (they're always in "slot 3"). Their 3 distinct
// khung giờ are instead any 3 evening call times that are each at least 60
// minutes apart from one another (e.g. 18:30 / 19:40 / 21:00 qualifies;
// 18:30 / 19:00 / 21:00 doesn't — the first pair is only 30 min apart).
// Evening window: 17:00-23:00 VN time — not given an exact bound, flagged
// for confirmation once this is in use.
const EVENING_START_MIN = 17 * 60;
const EVENING_END_MIN   = 23 * 60;
const MIN_GAP_MS = 60 * 60 * 1000;

function isEvening(dateOrMs) {
  const { hm } = vnParts(dateOrMs);
  return hm >= EVENING_START_MIN && hm < EVENING_END_MIN;
}

// Given call timestamps (Date/ms/string), true if at least 3 of them fall in
// the evening window and can be chosen such that each is >=60min from the
// next (classic greedy interval pick: sort ascending, keep one whenever it's
// far enough past the last one kept — maximises how many qualify).
function hasThreeGappedEveningCalls(timestamps) {
  const eveningMs = timestamps
    .filter(isEvening)
    .map((t) => (t instanceof Date ? t.getTime() : new Date(t).getTime()))
    .sort((a, b) => a - b);
  let kept = 0;
  let lastKeptMs = -Infinity;
  for (const ms of eveningMs) {
    if (ms - lastKeptMs >= MIN_GAP_MS) {
      kept += 1;
      lastKeptMs = ms;
      if (kept >= 3) return true;
    }
  }
  return false;
}

module.exports = { slotOf, vnDateKey, vnParts, isEvening, hasThreeGappedEveningCalls };
