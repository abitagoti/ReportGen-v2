'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-permmig-'));

const { db, migrateUserPermissionOverrides } = require('../server/database/database');
const now = new Date().toISOString();

test('a legacy `decision` override table is upgraded to `effect` without losing valid overrides', () => {
  db.prepare(`INSERT INTO companies (id,name,currency,created_at,updated_at) VALUES ('co1','Test Co','NGN',?,?)`).run(now, now);
  for (const id of ['u1', 'u2']) db.prepare(`INSERT INTO users (id,company_id,username,display_name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(id, 'co1', id, id, 'x', 'viewer', now, now);
  // Shape used by early development builds: `decision`, no updated_by, no UNIQUE constraint, no CHECK.
  db.exec('DROP TABLE user_permission_overrides');
  db.exec(`CREATE TABLE user_permission_overrides (id TEXT PRIMARY KEY, company_id TEXT, user_id TEXT, permission TEXT, decision TEXT, updated_at TEXT)`);
  db.exec('CREATE INDEX idx_user_permission_overrides_user ON user_permission_overrides(company_id, user_id)');
  const ins = db.prepare('INSERT INTO user_permission_overrides VALUES (?,?,?,?,?,?)');
  ins.run('o1', 'co1', 'u1', 'reports.view', 'Allow', '2026-01-01T00:00:00Z');
  ins.run('o2', 'co1', 'u1', 'reports.view', 'deny', '2026-02-01T00:00:00Z');   // newer duplicate wins
  ins.run('o3', 'co1', 'u2', 'capital.manage', 'allow', '2026-01-01T00:00:00Z');
  ins.run('o4', 'co1', 'u2', 'payroll.view', 'maybe', '2026-01-01T00:00:00Z');    // unrecognised value is dropped
  ins.run('o5', 'co1', 'ghost', 'sales.view', 'allow', '2026-01-01T00:00:00Z');   // deleted user is dropped

  const result = migrateUserPermissionOverrides();
  assert.equal(result.migrated, true);
  assert.equal(result.legacyRows, 5);
  assert.equal(result.copiedRows, 2);

  const cols = db.prepare('PRAGMA table_info(user_permission_overrides)').all().map(c => c.name);
  assert.ok(cols.includes('effect') && !cols.includes('decision'));
  const rows = db.prepare('SELECT user_id,permission,effect FROM user_permission_overrides ORDER BY user_id,permission').all();
  assert.deepEqual(rows.map(r => ({ ...r })), [
    { user_id: 'u1', permission: 'reports.view', effect: 'deny' },
    { user_id: 'u2', permission: 'capital.manage', effect: 'allow' }
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='user_permission_overrides_legacy'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_user_permission_overrides_user'").get().n, 1);
  assert.throws(() => db.prepare(`INSERT INTO user_permission_overrides(id,company_id,user_id,permission,effect,updated_at) VALUES ('bad','co1','u1','x','maybe',?)`).run(now), /CHECK|constraint/i);
});

test('the upgrade is idempotent and the resolver reads the upgraded table', () => {
  assert.equal(migrateUserPermissionOverrides().migrated, false);
  const { listUserPermissions } = require('../server/permissions');
  const rows = Object.fromEntries(listUserPermissions('co1', 'u1', 'viewer').map(p => [p.key, p]));
  assert.equal(rows['reports.view'].override, 'deny');
  assert.equal(rows['reports.view'].enabled, false);
});
