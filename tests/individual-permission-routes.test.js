'use strict';
// HTTP-level checks that individual permission overrides take effect in the real routes.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-permroutes-'));

const express = require('express');
const { db } = require('../server/database/database');
const { cookieMiddleware } = require('../server/lib/cookies');
const { createSession } = require('../server/auth/sessionService');
const { requireAuth } = require('../server/auth/middleware');
const { hashPassword } = require('../server/auth/passwordService');
const { saveUserPermissionOverrides } = require('../server/permissions');

const now = new Date().toISOString();
const USERS = { administrator: 'administrator', owner1: 'owner', owner2: 'owner', gm: 'general_manager', viewer: 'viewer', viewer2: 'viewer' };
let server, base;
const cookie = {};

test.before(async () => {
  db.pragma('foreign_keys=OFF');
  db.prepare(`INSERT INTO companies (id,name,currency,created_at,updated_at) VALUES ('co1','Test Co','NGN',?,?)`).run(now, now);
  for (const [name, role] of Object.entries(USERS)) {
    db.prepare(`INSERT INTO users (id,company_id,username,display_name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('u_' + name, 'co1', name, name, hashPassword('CorrectHorse1!'), role, now, now);
    cookie[name] = `reportgen_session=${createSession('u_' + name).token}`;
  }
  for (const id of ['b1', 'b2']) db.prepare(`INSERT INTO businesses (id,company_id,name,created_at,updated_at) VALUES (?,?,?,?,?)`).run(id, 'co1', id, now, now);
  db.prepare(`INSERT INTO user_business_access (user_id,business_id,created_at) VALUES ('u_viewer','b1',?)`).run(now);
  const cap = db.prepare(`INSERT INTO capital_contributions (id,company_id,business_id,period_start,period_end,amount,entry_mode,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  cap.run('c_own', 'co1', 'b1', '2026-10-05', '2026-10-05', 100, 'individual', '', 'u_viewer', now, now);
  cap.run('c_other', 'co1', 'b1', '2026-10-06', '2026-10-06', 200, 'individual', '', 'u_owner1', now, now);
  cap.run('c_unassigned', 'co1', 'b2', '2026-10-07', '2026-10-07', 300, 'individual', '', 'u_viewer', now, now);
  const app = express();
  app.use(express.json());
  app.use(cookieMiddleware);
  app.use('/api', requireAuth);
  for (const mod of ['permissionsRoutes', 'users/userRoutes', 'capital/capitalRoutes', 'accountant/accountantRoutes']) app.use(require('../server/' + mod));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

const call = (who, method, url, body) => fetch(base + url, { method, headers: { cookie: cookie[who], 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const set = (who, overrides) => saveUserPermissionOverrides('co1', 'u_' + who, overrides, 'u_administrator');

test('individual permissions can only be changed for accounts strictly below your own role', async () => {
  assert.equal((await call('owner1', 'PUT', '/api/users/u_owner2/permissions', { overrides: { 'reports.view': 'deny' } })).status, 403, 'peer owner');
  assert.equal((await call('owner1', 'GET', '/api/users/u_owner2/permissions')).status, 403, 'peer owner read');
  assert.equal((await call('owner1', 'PUT', '/api/users/u_gm/permissions', { overrides: { 'reports.view': 'deny' } })).status, 200, 'lower role');
  assert.equal((await call('gm', 'PUT', '/api/users/u_gm/permissions', { overrides: {} })).status, 403, 'self');
  assert.equal((await call('gm', 'PUT', '/api/users/u_viewer/permissions', { overrides: { 'capital.manage': 'allow', 'capital.view': 'allow' } })).status, 200, 'GM grants a permission they hold');
  const list = (await call('owner1', 'GET', '/api/users')).json.users;
  assert.equal(list.find(u => u.id === 'u_gm').canEditPermissions, true);
  assert.equal(list.find(u => u.id === 'u_owner2').canEditPermissions, false);
});

test('a Deny override on expenses.view blocks the company-wide expense endpoints', async () => {
  set('owner1', {});
  assert.equal((await call('owner1', 'GET', '/api/owner/expenses?month=2026-10')).status, 200);
  set('owner1', { 'expenses.view': 'deny' });
  assert.equal((await call('owner1', 'GET', '/api/owner/expenses?month=2026-10')).status, 403);
  assert.equal((await call('owner1', 'GET', '/api/owner/expense-summary?month=2026-10')).status, 200, 'Dashboard still works');
  set('owner1', { 'expenses.view': 'deny', 'dashboard.view': 'deny' });
  assert.equal((await call('owner1', 'GET', '/api/owner/expense-summary?month=2026-10')).status, 403);
  set('owner1', {});
});

test('a non-company-wide user holding capital.manage may edit/delete only their own assigned-business records', async () => {
  assert.equal((await call('viewer', 'PATCH', '/api/capital/c_own', { amount: 150 })).status, 200);
  assert.equal((await call('viewer', 'PATCH', '/api/capital/c_other', { amount: 1 })).status, 403);
  assert.equal((await call('viewer', 'PATCH', '/api/capital/c_unassigned', { amount: 1 })).status, 403);
  assert.equal((await call('viewer', 'PATCH', '/api/capital/c_own', { businessId: 'b2' })).status, 403);
  assert.equal((await call('viewer', 'PATCH', '/api/capital/c_own', { businessId: null })).status, 403);
  assert.equal((await call('viewer', 'DELETE', '/api/capital/c_other')).status, 403);
  assert.equal((await call('viewer', 'DELETE', '/api/capital/c_own')).status, 200);
  assert.equal((await call('owner1', 'PATCH', '/api/capital/c_other', { amount: 250 })).status, 200, 'owner unaffected');
  assert.equal((await call('viewer2', 'PATCH', '/api/capital/c_other', { amount: 1 })).status, 403, 'no capital.manage');
});
