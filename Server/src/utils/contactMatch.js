// One rule for "is this the same person's email / phone?" — used by the returning-student
// check (check-login / login-lookup) and by registration's duplicate guard.
//
//  • Email: case-insensitive, surrounding spaces ignored.
//  • Phone: compared on the LAST 9 DIGITS, ignoring spaces, "+", dashes and the country
//    code. Stored numbers look like "094 3608043", while the registration form sends
//    "+84 094 3608043" — an exact compare never matched. "0943608043", "+84943608043",
//    "094 3608043" and "+84 094 3608043" now all match each other. Fewer than 8 digits
//    never matches (an empty/partial number must not match everyone).

const MATCH_DIGITS = 9;
const MIN_DIGITS = 8;

const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

// Comparison key for a phone typed/sent by a client ('' when too short to trust).
function phoneKey(phone) {
  const d = digitsOnly(phone);
  return d.length >= MIN_DIGITS ? d.slice(-MATCH_DIGITS) : '';
}

const cleanEmail = (email) => String(email || '').trim();

// SQL for the same key computed from the stored column (matches phoneKey above).
const PHONE_SQL = `RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), ${MATCH_DIGITS})`;

// Builds `{ where, values }` for "email matches OR phone matches" (null when neither is usable).
function duplicateWhere(email, phone) {
  const conds = [];
  const values = [];
  const e = cleanEmail(email);
  const k = phoneKey(phone);
  if (e) { values.push(e); conds.push(`(email <> '' AND LOWER(BTRIM(email)) = LOWER($${values.length}))`); }
  if (k) { values.push(k); conds.push(`(LENGTH(${PHONE_SQL}) >= ${MIN_DIGITS} AND ${PHONE_SQL} = $${values.length})`); }
  return conds.length ? { where: conds.join(' OR '), values } : null;
}

module.exports = { phoneKey, cleanEmail, duplicateWhere, PHONE_SQL };
