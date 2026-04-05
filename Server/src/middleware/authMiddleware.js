function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ success: false, error: 'Authentication required' });
}

function requireCounselor(req, res, next) {
  if (req.session && req.session.authenticated && req.session.isCounselor) {
    return next();
  }
  res.status(403).json({ success: false, error: 'Staff access required' });
}

module.exports = { requireAuth, requireCounselor };
