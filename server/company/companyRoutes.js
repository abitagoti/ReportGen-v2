const express = require('express');
const { db } = require('../database/database');
const { requireAuth, requireRole, requirePermission } = require('../auth/middleware');
const { audit } = require('../audit/auditService');

const router = express.Router();

function ensureCompanyColumns() {
  const columns = db.prepare(`PRAGMA table_info(companies)`).all().map(x => x.name);
  const additions = [
    ['address', 'TEXT'],
    ['phone', 'TEXT'],
    ['email', 'TEXT'],
    ['logo_data_url', 'TEXT'],
    ['staff_id_prefix', "TEXT DEFAULT 'STF'"]
  ];
  for (const [name, type] of additions) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type}`);
  }
}
ensureCompanyColumns();

router.get('/api/company', requireAuth, (req, res) => {
  const company = db.prepare(`
    SELECT id, name, currency, address, phone, email, logo_data_url AS logoDataUrl, staff_id_prefix AS staffIdPrefix,
           created_at AS createdAt, updated_at AS updatedAt
    FROM companies WHERE id = ?
  `).get(req.user.company_id);
  res.json({ company });
});

router.patch('/api/company', requireAuth, requirePermission('settings.manage'), (req, res) => {
  const name = String(req.body?.name || '').trim();
  const currency = String(req.body?.currency || '').trim().toUpperCase();
  const address = String(req.body?.address || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const email = String(req.body?.email || '').trim();
  const logoDataUrl = String(req.body?.logoDataUrl || '').trim();
  const staffIdPrefix = String(req.body?.staffIdPrefix || 'STF').trim().toUpperCase();

  if (name.length < 2 || name.length > 150) return res.status(400).json({ error: 'Company name is invalid.' });
  if (currency.length < 3 || currency.length > 6) return res.status(400).json({ error: 'Currency is invalid.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Company email is invalid.' });
  if (!/^[A-Z0-9][A-Z0-9-]{1,11}$/.test(staffIdPrefix)) return res.status(400).json({ error: 'Staff ID prefix must be 2–12 characters using letters, numbers or hyphens.' });
  if (logoDataUrl && (!logoDataUrl.startsWith('data:image/') || logoDataUrl.length > 2_500_000)) {
    return res.status(400).json({ error: 'Company logo is invalid or too large.' });
  }

  db.prepare(`
    UPDATE companies SET name = ?, currency = ?, address = ?, phone = ?, email = ?, logo_data_url = ?, staff_id_prefix = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, currency, address || null, phone || null, email || null, logoDataUrl || null, staffIdPrefix, req.user.company_id);

  audit(req,{action:'company.updated',entityType:'company',entityId:req.user.company_id,details:{name,currency,address,phone,email,staffIdPrefix,logoUpdated:Boolean(logoDataUrl)}});
  res.json({ ok: true });
});

module.exports = router;
