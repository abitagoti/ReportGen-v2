const express = require('express');
const { z } = require('zod');
const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { hashPassword } = require('../auth/passwordService');
const { audit } = require('../audit/auditService');
const { requireAuth, requirePermission } = require('../auth/middleware');
const { isAdministrator, canManageTargetRole } = require('../security/rolePolicy');

const router = express.Router();

const userSchema = z.object({
  username: z.string().trim().min(3).max(80),
  displayName: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(200),
  role: z.enum(['administrator', 'owner', 'general_manager', 'accountant', 'business_manager', 'viewer'])
});

router.get('/api/users', requireAuth, requirePermission('users.manage'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName, u.role, u.is_active AS isActive,
           u.created_at AS createdAt,
           COALESCE(GROUP_CONCAT(uba.business_id), '') AS businessIds
    FROM users u
    LEFT JOIN user_business_access uba ON uba.user_id = u.id
    WHERE u.company_id = ?
    GROUP BY u.id
    ORDER BY u.display_name
  `).all(req.user.company_id)
    .filter(user => String(user.id) === String(req.user.user_id) || canManageTargetRole(req.user, user.role));

  res.json({ users: users.map(user => ({ ...user, businessIds: user.businessIds ? user.businessIds.split(',').filter(Boolean) : [] })) });
});

router.post('/api/users', requireAuth, requirePermission('users.manage'), (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user.' });

  // Users may only create accounts at or below their own role level.
  // Administrators may create any configured role. This prevents a lower-level
  // account from creating an Owner/Administrator even if users.manage is granted.
  if (!canManageTargetRole(req.user, parsed.data.role)) {
    return res.status(403).json({ error: 'You cannot create an account with a higher-privilege role.' });
  }

  const userId = id('usr');
  const now = nowIso();

  try {
    db.prepare(`
      INSERT INTO users
        (id, company_id, username, display_name, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      req.user.company_id,
      parsed.data.username,
      parsed.data.displayName,
      hashPassword(parsed.data.password),
      parsed.data.role,
      now,
      now
    );
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That username already exists in this company.' });
    }
    throw error;
  }

  audit(req, {
    action: 'user.created',
    entityType: 'user',
    entityId: userId,
    details: { username: parsed.data.username, role: parsed.data.role }
  });

  res.status(201).json({ userId });
});


router.delete('/api/users/:userId', requireAuth, requirePermission('users.manage'), (req, res) => {
  const userId = String(req.params.userId || '');
  if (userId === String(req.user.user_id)) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  const target = db.prepare('SELECT id,display_name AS displayName,username,role,is_active AS isActive FROM users WHERE id=? AND company_id=?').get(userId, req.user.company_id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (!canManageTargetRole(req.user, target.role)) return res.status(403).json({ error: 'You cannot manage a higher-privilege account.' });
  if (isAdministrator({ role: target.role })) return res.status(403).json({ error: 'The System Administrator account is protected and cannot be deleted.' });
  if (!target.isActive) return res.status(409).json({ error: 'User account is already inactive.' });
  const stamp = nowIso();
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET is_active=0,updated_at=? WHERE id=? AND company_id=?').run(stamp, userId, req.user.company_id);
    db.prepare('DELETE FROM user_business_access WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
  });
  tx();
  audit(req, { action:'user.deactivated', entityType:'user', entityId:userId, details:{username:target.username,displayName:target.displayName,role:target.role,historyPreserved:true} });
  res.json({ message:'User account deactivated. Historical records were preserved.' });
});

router.patch('/api/users/:userId/status', requireAuth, requirePermission('users.manage'), (req, res) => {
  const userId = String(req.params.userId || '');
  const isActive = req.body?.isActive === true;
  if (userId === String(req.user.user_id) && !isActive) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  const target = db.prepare('SELECT id,username,role,is_active AS isActive FROM users WHERE id=? AND company_id=?').get(userId, req.user.company_id);
  if (!target) return res.status(404).json({ error:'User not found.' });
  if (!canManageTargetRole(req.user, target.role)) return res.status(403).json({ error: 'You cannot change the status of a higher-privilege account.' });
  if (isAdministrator({role:target.role})) return res.status(403).json({ error:'The System Administrator account is protected and cannot be deleted or deactivated.' });
  const stamp=nowIso();
  db.prepare('UPDATE users SET is_active=?,updated_at=? WHERE id=? AND company_id=?').run(isActive?1:0,stamp,userId,req.user.company_id);
  if (!isActive) { db.prepare('DELETE FROM user_business_access WHERE user_id=?').run(userId); db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }
  audit(req,{action:isActive?'user.reactivated':'user.deactivated',entityType:'user',entityId:userId,details:{historyPreserved:true}});
  res.json({message:isActive?'User account reactivated.':'User account deactivated. Historical records were preserved.'});
});

router.put('/api/users/:userId/business-access', requireAuth, requirePermission('users.manage'), (req, res) => {
  const userId = req.params.userId;
  const businessIds = Array.isArray(req.body?.businessIds) ? req.body.businessIds : [];

  const user = db.prepare('SELECT id,role FROM users WHERE id = ? AND company_id = ?')
    .get(userId, req.user.company_id);

  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!canManageTargetRole(req.user, user.role)) return res.status(403).json({ error: 'You cannot manage business access for a higher-privilege account.' });

  const valid = db.prepare(`
    SELECT id FROM businesses
    WHERE company_id = ? AND id IN (${businessIds.map(() => '?').join(',') || "''"})
  `).all(req.user.company_id, ...businessIds).map(x => x.id);

  const update = db.transaction(() => {
    db.prepare('DELETE FROM user_business_access WHERE user_id = ?').run(userId);
    const insert = db.prepare(`
      INSERT INTO user_business_access (user_id, business_id, created_at)
      VALUES (?, ?, ?)
    `);
    for (const businessId of valid) insert.run(userId, businessId, nowIso());
  });

  update();

  audit(req, {
    action: 'user.business_access.updated',
    entityType: 'user',
    entityId: userId,
    details: { businessIds: valid }
  });

  res.json({ userId, businessIds: valid });
});

module.exports = router;
