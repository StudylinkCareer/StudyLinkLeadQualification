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

module.exports = { slotOf, vnDateKey, vnParts };
