const crypto = require('node:crypto');
const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const config = require('../config');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expires = new Date(now + config.sessionTtlMs).toISOString();

  db.prepare(`
    INSERT INTO sessions
      (id, user_id, token_hash, csrf_token, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id('ses'), userId, hashToken(token), csrf, expires, nowIso(), nowIso());

  return { token, csrf, expiresAt: expires };
}

const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function cleanupExpiredSessions() {
  const now = nowIso();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
}

function getSession(token) {
  if (!token) return null;

  const row = db.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id,
      s.csrf_token,
      s.expires_at,
      u.company_id,
      u.username,
      u.display_name,
      u.role,
      u.is_active,
      s.last_seen_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(hashToken(token));

  if (!row || !row.is_active || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }

  const lastSeenMs = Date.parse(row.last_seen_at || '');
  if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs >= LAST_SEEN_WRITE_INTERVAL_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
      .run(nowIso(), row.session_id);
  }

  return row;
}

const cleanupTimer = setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
cleanupTimer.unref?.();

function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

module.exports = { createSession, getSession, destroySession, cleanupExpiredSessions, LAST_SEEN_WRITE_INTERVAL_MS };
