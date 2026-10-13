const express = require('express');
const { db } = require('../database/database');
const { requireAuth, requirePermission } = require('../auth/middleware');

const router = express.Router();

router.get('/api/audit/meta', requireAuth, requirePermission('audit.view'), (req, res) => {
  const companyId = req.user.company_id;
  const actions = db.prepare(`SELECT DISTINCT action FROM audit_logs WHERE company_id=? ORDER BY action`).all(companyId).map(x => x.action);
  const users = db.prepare(`SELECT DISTINCT u.id AS id, u.username, u.display_name AS displayName FROM audit_logs a JOIN users u ON u.id=a.user_id WHERE a.company_id=? ORDER BY COALESCE(u.display_name,u.username), u.username`).all(companyId);
  const businesses = db.prepare(`SELECT id,name FROM businesses WHERE company_id=? ORDER BY name`).all(companyId);
  res.json({ actions, users, businesses });
});

router.get('/api/audit', requireAuth, requirePermission('audit.view'), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const action = String(req.query.action || '').trim();
  const businessId = String(req.query.businessId || '').trim();
  const userId = String(req.query.userId || '').trim();
  const requestedFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '';
  const requestedTo = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : '';
  const allHistory = String(req.query.allHistory || '') === '1';
  const search = String(req.query.search || '').trim().slice(0, 120);
  // Never make the audit landing page scan the company's entire history.
  // A bounded default window keeps the first query fast even on very large logs.
  const from = requestedFrom || (!allHistory ? (() => { const d = new Date(); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate()-30); return d.toISOString().slice(0,10); })() : '');
  const to = requestedTo || (!allHistory ? new Date().toISOString().slice(0,10) : '');

  const where = ['a.company_id = ?'];
  const params = [req.user.company_id];
  if (action) { where.push('a.action = ?'); params.push(action); }
  if (businessId) { where.push('a.business_id = ?'); params.push(businessId); }
  if (userId) { where.push('a.user_id = ?'); params.push(userId); }
  if (from) { where.push("a.created_at >= ?"); params.push(`${from}T00:00:00.000Z`); }
  if (to) { const d = new Date(`${to}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate()+1); where.push("a.created_at < ?"); params.push(d.toISOString()); }
  if (search) { where.push(`(a.action LIKE ? OR a.entity_type LIKE ? OR COALESCE(a.entity_id,'') LIKE ? OR COALESCE(a.details_json,'') LIKE ? OR COALESCE(u.username,'') LIKE ? OR COALESCE(u.display_name,'') LIKE ?)`); const q=`%${search}%`; params.push(q,q,q,q,q,q); }

  const rows = db.prepare(`
    SELECT
      a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
      a.business_id AS businessId, a.details_json AS details,
      a.ip_address AS ipAddress, a.created_at AS createdAt,
      u.id AS userId, u.username, u.display_name AS displayName
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit + 1, offset);

  const hasMore = rows.length > limit;
  rows.length = Math.min(rows.length, limit);

  res.json({
    audit: rows.map(row => ({
      ...row,
      details: row.details ? (() => { try { return JSON.parse(row.details); } catch { return { raw: row.details }; } })() : {}
    })),
    pagination: { limit, offset, hasMore, boundedByDefault: !allHistory && !requestedFrom && !requestedTo },
    filters: { action: action || null, businessId: businessId || null, userId: userId || null, from: from || null, to: to || null, search: search || null, allHistory }
  });
});

module.exports = router;
