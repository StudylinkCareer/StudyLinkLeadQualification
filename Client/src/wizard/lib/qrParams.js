// Event-QR deep link: ?sol=Event/Campaign&eid=<id>&ename=<name>&counsellor=<name>
// Captured once (splash or register) and kept in sessionStorage so it survives the
// splash tap and page reloads. Same parameter names as the legacy Home form.
const KEY = 'wz_qr';

export function captureQrParams(search = window.location.search) {
  const p = new URLSearchParams(search);
  const found = {
    sol: p.get('sol') || '',
    eid: p.get('eid') || '',
    ename: p.get('ename') || p.get('en') || '',
    counsellor: p.get('counsellor') || '',
  };
  if (found.sol || found.eid || found.ename || found.counsellor) {
    try { sessionStorage.setItem(KEY, JSON.stringify(found)); } catch { /* private mode */ }
    return found;
  }
  return readQrParams();
}

export function readQrParams() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') || {}; } catch { return {}; }
}

export const normText = (x) => String(x || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// Find the marketing event a QR link points at: by id first, then by name.
export function matchEvent(events, qr) {
  if (!qr || !events || !events.length) return null;
  if (qr.eid) {
    const byId = events.find((o) => String(o.id) === String(qr.eid));
    if (byId) return byId;
  }
  if (qr.ename) {
    const n = normText(qr.ename);
    return events.find((o) => normText(o.name) === n || normText(o.labelEn) === n || normText(o.labelVi) === n) || null;
  }
  return null;
}
