// Customer-app ownership check: a session may only touch student records it has
// "claimed" (registered, or matched by its own email/phone lookup). Switched by
// ENFORCE_STUDENT_OWNERSHIP=true so it can ship OFF and be flipped without a redeploy.
// Registration/login OTP are bypassed on purpose (known), so this narrows access to
// records the caller could already reach by knowing the email/phone — it stops ID guessing.

const MAX_OWNED = 50;

function enforcing() {
  return String(process.env.ENFORCE_STUDENT_OWNERSHIP || '').toLowerCase() === 'true';
}

function ownedIds(req) {
  const list = req.session && req.session.ownedStudentIds;
  return Array.isArray(list) ? list : [];
}

function bindStudent(req, ...ids) {
  if (!req.session) return;
  const set = new Set(ownedIds(req));
  for (const id of ids) if (id) set.add(String(id));
  req.session.ownedStudentIds = [...set].slice(-MAX_OWNED);
}

function ownsStudent(req, id) {
  if (!id) return false;
  const sid = String(id);
  return ownedIds(req).includes(sid) || (req.session && req.session.studentId === sid);
}

// GET /students/<email> is also accepted by getStudent; that form is only allowed
// for the session's own authenticated email.
function isOwnEmail(req, value) {
  const mine = req.session && req.session.email;
  return !!mine && String(value).trim().toLowerCase() === String(mine).toLowerCase();
}

function requireOwnStudent(req, res, next) {
  if (!enforcing()) return next();
  const id = req.params.id;
  if (id && id.includes('@') ? isOwnEmail(req, id) : ownsStudent(req, id)) return next();
  return res.status(403).json({ success: false, error: 'Forbidden' });
}

module.exports = { enforcing, bindStudent, ownsStudent, isOwnEmail, requireOwnStudent };
