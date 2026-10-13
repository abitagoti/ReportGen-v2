const { getSession } = require('./sessionService');
const { db } = require('../database/database');
const { hasPermission } = require('../permissions');

function requireAuth(req, res, next) {
  const token = req.cookies?.reportgen_session;
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });
  req.user = session;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    const allowed = roles.map(role => String(role || '').toLowerCase());
    if (!allowed.includes(String(req.user.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'You do not have permission for this action.' });
    }
    next();
  };
}

function requireCsrf(req, res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (safe) return next();

  const supplied = req.get('x-csrf-token');
  if (!supplied || supplied !== req.user.csrf_token) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req, permission)) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}

function requireBusinessAccess(req, res, next) {
  const businessId = req.params.businessId || req.body?.businessId || req.query?.businessId;
  if (!businessId) return res.status(400).json({ error: 'businessId is required.' });

  if (['owner', 'general_manager', 'administrator', 'admin', 'accountant'].includes(req.user.role)) return next();

  const row = db.prepare(`
    SELECT 1
    FROM user_business_access a
    JOIN businesses b ON b.id = a.business_id
    WHERE a.user_id = ? AND a.business_id = ? AND b.company_id = ?
  `).get(req.user.user_id, businessId, req.user.company_id);

  if (!row) return res.status(403).json({ error: 'No access to this business.' });
  next();
}

module.exports = { requireAuth, requireRole, requirePermission, requireCsrf, requireBusinessAccess };
