'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('user permission overrides are stored separately from role defaults and constrained to allow/deny', () => {
  const schema = fs.readFileSync(path.join(root,'server/database/schema.sql'),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS user_permission_overrides/);
  assert.match(schema,/UNIQUE\(company_id, user_id, permission\)/);
  assert.match(schema,/CHECK\(effect IN \('allow','deny'\)\)/);
  const permissions = fs.readFileSync(path.join(root,'server/permissions.js'),'utf8');
  assert.match(permissions,/function listUserPermissions/);
  assert.match(permissions,/function saveUserPermissionOverrides/);
  assert.match(permissions,/row\.override_value === 'allow'/);
  assert.match(permissions,/base\.set\(row\.permission, row\.override_value === 'allow'\)/);
});
test('individual permission API is protected, tenant-scoped, audited, and supports inheritance', () => {
  const routes = fs.readFileSync(path.join(root,'server/permissionsRoutes.js'),'utf8');
  assert.match(routes,/\/api\/users\/:userId\/permissions/);
  assert.match(routes,/requirePermission\('users\.manage'\)/);
  assert.match(routes,/WHERE id=\? AND company_id=\?/);
  assert.match(routes,/You cannot grant a permission your account does not currently have/);
  assert.match(routes,/user\.permissions\.updated/);
  assert.match(routes,/value!=='inherit'/);
});
test('user interface exposes per-user permissions without removing business assignment controls', () => {
  const ui = fs.readFileSync(path.join(root,'public/js/pages/users.js'),'utf8');
  assert.match(ui,/data-user-permissions/);
  assert.match(ui,/Inherit role/);
  assert.match(ui,/Reset to role defaults/);
  assert.match(ui,/data-access/);
});

test('permission-management authorization resolves individual overrides, not role defaults alone', () => {
  const routes = fs.readFileSync(path.join(root,'server/permissionsRoutes.js'),'utf8');
  assert.match(routes,/function effectivePermissions\(req\)\{[^}]*effectivePermissionSet\(req\)/);
  const permissions = fs.readFileSync(path.join(root,'server/permissions.js'),'utf8');
  assert.match(permissions,/function effectivePermissionSet\(req\)[\s\S]*?listUserPermissions\(req\.user\.company_id, req\.user\.user_id, req\.user\.role\)/);
});
