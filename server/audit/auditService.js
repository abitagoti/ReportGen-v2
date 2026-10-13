const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');

function audit(req, {
  action,
  entityType,
  entityId = null,
  businessId = null,
  details = {}
}) {
  db.prepare(`
    INSERT INTO audit_logs
      (id, company_id, user_id, action, entity_type, entity_id, business_id,
       details_json, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id('audit'),
    req.user.company_id,
    req.user.user_id,
    action,
    entityType,
    entityId,
    businessId,
    JSON.stringify(details),
    req.ip,
    req.get('user-agent') || null,
    nowIso()
  );
}

module.exports = { audit };
