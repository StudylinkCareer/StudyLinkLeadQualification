// POSM QR (umbrella, fan, helmet...): /q/<code> counts a scan, stores the item
// here, then opens the sign-up form, which tags the sign-up with it. Kept in
// sessionStorage like the event-QR params; an event QR clears it (and vice versa).
const KEY = 'wz_posm';

export function savePosm(item) {
  try { sessionStorage.setItem(KEY, JSON.stringify(item)); } catch { /* private mode */ }
}

export function readPosm() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function clearPosm() {
  try { sessionStorage.removeItem(KEY); } catch { /* private mode */ }
}
