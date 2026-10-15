'use strict';
// Behavioural tests: these execute the real permission resolver against a real database.
// (user-permission-overrides.test.js only pattern-matches source text.)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-userperm-'));

const { db } = require('../server/database/database');
const { hasPermission, listUserPermissions, saveUserPermissionOverrides, savePermissions, PERMISSIONS, DEFAULTS } = require('../server/permissions');

const now = new Date().toISOString();
db.prepare(`INSERT INTO companies (id,name,currency,created_at,updated_at) VALUES ('co1','Test Co','NGN',?,?)`).run(now, now);
for (const role of ['administrator', 'owner', 'general_manager', 'viewer']) {
  db.prepare(`INSERT INTO users (id,company_id,username,display_name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('u_' + role, 'co1', role, role, 'x', role, now, now);
}
// A fresh req.user per call mirrors requireAuth, which builds a new session row for every request.
const reqFor = role => ({ user: { user_id: 'u_' + role, company_id: 'co1', role } });
const set = (role, overrides) => saveUserPermissionOverrides('co1', 'u_' + role, overrides, 'u_administrator');

test('every permission: a viewer only has what the role grants, and an Allow override opens exactly that permission', () => {
  for (const [key] of PERMISSIONS) {
    set('viewer', {});
    assert.equal(hasPermission(reqFor('viewer'), key), DEFAULTS.viewer.includes(key), `${key} baseline`);
    set('viewer', { [key]: 'allow' });
    assert.equal(hasPermission(reqFor('viewer'), key), true, `${key} allowed by override`);
    const others = PERMISSIONS.map(p => p[0]).filter(k => k !== key && !DEFAULTS.viewer.includes(k));
    for (const other of others) assert.equal(hasPermission(reqFor('viewer'), other), false, `${key} override must not open ${other}`);
  }
  set('viewer', {});
});

test('a Deny override removes a permission the role grants, and nothing else', () => {
  set('owner', { 'expenses.view': 'deny' });
  assert.equal(hasPermission(reqFor('owner'), 'expenses.view'), false);
  assert.equal(hasPermission(reqFor('owner'), 'expenses.manage'), true);
  assert.equal(hasPermission(reqFor('owner'), 'dashboard.view'), true);
  set('owner', {});
  assert.equal(hasPermission(reqFor('owner'), 'expenses.view'), true);
});

test('individual overrides win over customised role permissions in both directions', () => {
  savePermissions('co1', 'general_manager', ['dashboard.view', 'reports.view'], 'u_administrator');
  set('general_manager', { 'reports.view': 'deny', 'capital.view': 'allow' });
  assert.equal(hasPermission(reqFor('general_manager'), 'dashboard.view'), true);
  assert.equal(hasPermission(reqFor('general_manager'), 'reports.view'), false);
  assert.equal(hasPermission(reqFor('general_manager'), 'capital.view'), true);
  assert.equal(hasPermission(reqFor('general_manager'), 'payroll.view'), false);
  set('general_manager', {});
});

test('listUserPermissions reports override state and Administrators always pass', () => {
  set('viewer', { 'reports.view': 'deny', 'capital.view': 'allow' });
  const rows = Object.fromEntries(listUserPermissions('co1', 'u_viewer', 'viewer').map(p => [p.key, p]));
  assert.equal(rows['reports.view'].override, 'deny');
  assert.equal(rows['reports.view'].enabled, false);
  assert.equal(rows['capital.view'].override, 'allow');
  assert.equal(rows['dashboard.view'].override, 'inherit');
  set('viewer', {});
  db.prepare(`INSERT INTO user_permission_overrides(id,company_id,user_id,permission,effect,updated_by,updated_at) VALUES ('x1','co1','u_administrator','users.manage','deny',NULL,?)`).run(now);
  assert.equal(hasPermission(reqFor('administrator'), 'users.manage'), true);
});

test('permission changes apply to the very next request', () => {
  set('viewer', {});
  assert.equal(hasPermission(reqFor('viewer'), 'capital.manage'), false);
  set('viewer', { 'capital.manage': 'allow' });
  assert.equal(hasPermission(reqFor('viewer'), 'capital.manage'), true);
  set('viewer', {});
  assert.equal(hasPermission(reqFor('viewer'), 'capital.manage'), false);
});

test('permission checks no longer re-inspect the table schema or re-query within one request', () => {
  hasPermission(reqFor('viewer'), 'dashboard.view'); // primes the column lookup
  const original = db.prepare;
  const seen = [];
  db.prepare = function (sql) { seen.push(String(sql)); return original.call(this, sql); };
  try {
    for (let i = 0; i < 10; i++) hasPermission(reqFor('viewer'), 'reports.view');
    assert.equal(seen.filter(s => /PRAGMA table_info/i.test(s)).length, 0, 'schema must not be inspected per check');
    seen.length = 0;
    const req = reqFor('viewer');
    for (let i = 0; i < 25; i++) hasPermission(req, PERMISSIONS[i % PERMISSIONS.length][0]);
    assert.equal(seen.filter(s => /FROM role_permissions/i.test(s)).length, 1, 'role rows are read once per request');
    assert.equal(seen.filter(s => /FROM user_permission_overrides/i.test(s)).length, 1, 'override rows are read once per request');
  } finally { db.prepare = original; }
});
