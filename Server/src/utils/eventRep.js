// Server/src/utils/eventRep.js
// Helpers for event-rep account creation.

// Strip Vietnamese diacritics + đ/Đ and whitespace for a typable ASCII id.
function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // combining marks
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/\s+/g, '');
}

// Logon id for a NEW event-only recruit:
//   [FamilyName][FullGivenName]yyyymm@studylink.org  (diacritics/spaces stripped)
// e.g. "Nguyễn Văn Vinh", 2026-07 -> "NguyenVanVinh202607@studylink.org"
// `date` defaults to now; pass one for determinism/testing.
function eventLogonId(fullName, date = new Date()) {
  const base = stripDiacritics(fullName);
  const yyyymm = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  return `${base}${yyyymm}@studylink.org`;
}

const EVENT_DEFAULT_PASSWORD = 'ChangeYourPassword';

module.exports = { stripDiacritics, eventLogonId, EVENT_DEFAULT_PASSWORD };
