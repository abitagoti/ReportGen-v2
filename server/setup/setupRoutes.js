const express = require('express');
const { z } = require('zod');
const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { hashPassword } = require('../auth/passwordService');
const LEGAL_VERSION = '2026-09-19';

const router = express.Router();

const setupSchema = z.object({
  companyName: z.string().trim().min(2).max(150),
  address: z.string().trim().max(300).optional().default(''),
  phone: z.string().trim().max(60).optional().default(''),
  email: z.string().trim().max(160).email().or(z.literal('')).optional().default(''),
  currency: z.string().trim().min(3).max(6).default('NGN'),
  adminUsername: z.string().trim().min(3).max(80),
  adminDisplayName: z.string().trim().min(2).max(120),
  adminPassword: z.string().min(8).max(200),
  acceptTerms: z.literal(true),
  acceptPrivacy: z.literal(true),
  acceptDisclaimer: z.literal(true),
  acceptAcceptableUse: z.literal(true),
  logoDataUrl: z.string().max(2_500_000).optional().default('')
});

router.get('/api/public/branding', (req, res) => {
  const company = db.prepare('SELECT name, logo_data_url AS logoDataUrl FROM companies ORDER BY created_at ASC LIMIT 1').get();
  res.json({ name: company?.name || 'ReportGen', logoDataUrl: company?.logoDataUrl || null });
});

router.get('/api/setup/status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM companies').get().count;
  res.json({
    setupComplete: count > 0,
    companyCount: count,
    legalVersion: LEGAL_VERSION
  });
});

router.post('/api/setup', (req, res) => {
  const existing = db.prepare('SELECT 1 FROM companies LIMIT 1').get();
  if (existing) return res.status(409).json({ error: 'Setup has already been completed.' });

  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Complete all required setup and legal acknowledgements.' });

  const input = parsed.data;
  const companyId = id('co');
  const userId = id('usr');
  const now = nowIso();

  const create = db.transaction(() => {
    db.prepare(`INSERT INTO companies (id, name, currency, address, phone, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(companyId, input.companyName, input.currency.toUpperCase(), input.address || null, input.phone || null, input.email || null, now, now);

    if (input.logoDataUrl) {
      if (!input.logoDataUrl.startsWith('data:image/')) throw new Error('Invalid company logo.');
      db.prepare('UPDATE companies SET logo_data_url = ?, updated_at = ? WHERE id = ?').run(input.logoDataUrl, now, companyId);
    }

    db.prepare(`INSERT INTO users (id, company_id, username, display_name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'administrator', ?, ?)`)
      .run(userId, companyId, input.adminUsername, input.adminDisplayName, hashPassword(input.adminPassword), now, now);

    db.prepare(`INSERT INTO legal_acceptances (id, company_id, user_id, terms_version, privacy_version, disclaimer_version, acceptable_use_version, accepted_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id('legal'), companyId, userId, LEGAL_VERSION, LEGAL_VERSION, LEGAL_VERSION, LEGAL_VERSION, now, req.ip || null, req.get('user-agent') || null);
  });

  create();
  res.status(201).json({ companyId, userId, legalVersion: LEGAL_VERSION });
});

module.exports = router;
