// Same normalisation the legacy Home form applies: digits only, max 10, always
// starts with 0, shown as "xxx xxxxxxx". Stored/sent in that formatted form.
export function formatPhoneInput(raw) {
  let digits = String(raw || '').replace(/\D/g, '').slice(0, 10);
  if (!digits.startsWith('0')) digits = '0' + digits.slice(0, 9);
  return digits.length > 3 ? digits.slice(0, 3) + ' ' + digits.slice(3) : digits;
}

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

export const YOB_MIN = 1980;
export const YOB_MAX = 2018;
export function isValidYob(v) {
  const n = parseInt(v, 10);
  return !isNaN(n) && n >= YOB_MIN && n <= YOB_MAX;
}
