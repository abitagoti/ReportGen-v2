const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('business manager default permissions do not include capital access', () => {
  const source = read('server/permissions.js');
  const match = source.match(/business_manager:\s*\[([^\]]+)\]/);
  assert.ok(match, 'business_manager defaults must exist');
  assert.equal(/capital\.view|capital\.manage/.test(match[1]), false);
});

test('business access middleware enforces tenant company scope', () => {
  const source = read('server/auth/middleware.js');
  assert.match(source, /JOIN businesses b ON b\.id = a\.business_id/);
  assert.match(source, /b\.company_id = \?/);
});

test('owner expense allocation endpoints remain Owner-only', () => {
  const source = read('server/dashboard/dashboardRoutes.js');
  assert.match(source, /function ownerAccess\(req\)\{return roleOf\(req\)==='owner';\}/);
  for (const route of ['owner-default','owner-adjustment','owner-allocation']) {
    const start = source.indexOf(`'/api/dashboard/${route}'`);
    assert.ok(start >= 0, `${route} route missing`);
    const chunk = source.slice(start, start + 500);
    assert.match(chunk, /ownerAccess\(req\)/, `${route} must enforce owner access`);
  }
  assert.match(source, /owner-allocation\/:businessId\/:month/);
});

test('administrator role permissions remain protected from non-administrators', () => {
  const source = read('server/permissionsRoutes.js');
  assert.match(source, /ADMIN_ROLES\.has\(role\).*Administrator permissions are protected/s);
  assert.match(source, /canEditRole\(req\.user\.role,role\)/);
});

test('role middleware normalizes role names before comparison', () => {
  const source = read('server/auth/middleware.js');
  assert.match(source, /roles\.map\(role => String\(role \|\| ''\)\.toLowerCase\(\)\)/);
  assert.match(source, /String\(req\.user\.role \|\| ''\)\.toLowerCase\(\)/);
});

test('message recipient discovery requires messaging permission', () => {
  const source = read('server/messages/messageRoutes.js');
  assert.match(source, /\/api\/messages\/recipients', requireAuth, requirePermission\('messages\.send'\)/);
});
