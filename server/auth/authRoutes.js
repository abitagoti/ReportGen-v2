const express = require('express');
const { db } = require('../database/database');
const { verifyPassword, hashPassword } = require('./passwordService');
const { createSession, destroySession } = require('./sessionService');
const { audit } = require('../audit/auditService');
const { requireAuth } = require('./middleware');
const { rateLimit } = require('../security/rateLimiter');
const config = require('../config');

const router = express.Router();

const loginWindowMs = 15 * 60 * 1000;
const loginLimit = rateLimit({ windowMs: loginWindowMs, max: 10 });
const usernameLoginLimit = rateLimit({
  windowMs: loginWindowMs,
  max: 5,
  keyGenerator: req => `login-user:${String(req.body?.username || '').trim().toLowerCase().slice(0, 120) || 'unknown'}`
});

// Keep password verification timing similar even when the username does not exist.
// The value is only a dummy verifier and is never stored for a real account.
const DUMMY_PASSWORD_HASH = hashPassword('ReportGen-Dummy-Password-Only-For-Timing-1!');

function secureRequest(req) {
  return req.secure === true;
}

function requireSecureTransport(req, res, next) {
  if (config.isLoopback || secureRequest(req) || config.allowInsecureLan) return next();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(426).json({ error: 'A secure HTTPS connection is required for ReportGen over the local network.' });
}

router.post('/api/auth/login', loginLimit, usernameLoginLimit, requireSecureTransport, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = db.prepare(`
    SELECT id, company_id, username, display_name, password_hash, role, is_active
    FROM users
    WHERE username = ? AND is_active = 1
    LIMIT 1
  `).get(username.trim());

  const passwordValid = user
    ? verifyPassword(password, user.password_hash)
    : verifyPassword(password, DUMMY_PASSWORD_HASH);

  if (!user || !passwordValid) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const session = createSession(user.id);
  res.cookie('reportgen_session', session.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureRequest(req),
    maxAge: config.sessionTtlMs,
    path: '/'
  });

  res.json({
    user: {
      id: user.id,
      companyId: user.company_id,
      username: user.username,
      displayName: user.display_name,
      role: user.role
    },
    csrfToken: session.csrf,
    expiresAt: session.expiresAt
  });
});



router.post('/api/auth/change-password', requireAuth, requireSecureTransport, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'Current password, new password and confirmation are required.' });
  }
  if (newPassword.length < 8 || newPassword.length > 200) {
    return res.status(400).json({ error: 'New password must be between 8 and 200 characters.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirmation do not match.' });
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE id=? AND company_id=? AND is_active=1').get(req.user.user_id, req.user.company_id);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  if (verifyPassword(newPassword, user.password_hash)) {
    return res.status(400).json({ error: 'New password must be different from your current password.' });
  }

  const stamp = new Date().toISOString();
  const newHash = hashPassword(newPassword);
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=? AND company_id=?').run(newHash, stamp, user.id, req.user.company_id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  });
  tx();

  audit(req, {
    action: 'user.password.changed',
    entityType: 'user',
    entityId: user.id,
    details: { username: user.username, sessionsInvalidated: true }
  });

  res.clearCookie('reportgen_session');
  res.json({ message: 'Password changed successfully. Please sign in again.' });
});

router.post('/api/auth/logout', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  destroySession(req.cookies.reportgen_session);
  res.clearCookie('reportgen_session');
  res.status(204).end();
});

router.get('/api/auth/me', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    user: {
      id: req.user.user_id,
      companyId: req.user.company_id,
      username: req.user.username,
      displayName: req.user.display_name,
      role: req.user.role
    },
    csrfToken: req.user.csrf_token,
    expiresAt: req.user.expires_at
  });
});

module.exports = router;
