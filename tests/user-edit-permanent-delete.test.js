const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('user edit endpoint validates updates, enforces role limits, and invalidates sessions on password change', () => {
  const route = read('server/users/userRoutes.js');
  assert.match(route, /router\.patch\('\/api\/users\/:userId'/);
  assert.match(route, /userUpdateSchema\.safeParse\(req\.body\)/);
  assert.match(route, /canManageTargetRole\(req\.user, target\.role\)/);
  assert.match(route, /You cannot change your own role/);
  assert.match(route, /You cannot assign a higher-privilege role/);
  assert.match(route, /if \(changes\.password \|\| roleChanged\) db\.prepare\('DELETE FROM sessions WHERE user_id = \?'\)/);
  assert.match(route, /That username already exists in this company/);
});

test('user delete permanently deletes the account transactionally and preserves an audit entry', () => {
  const route = read('server/users/userRoutes.js');
  const start = route.indexOf("router.delete('/api/users/:userId'");
  const end = route.indexOf("router.patch('/api/users/:userId/status'", start);
  assert.ok(start >= 0 && end > start);
  const block = route.slice(start, end);
  assert.match(block, /DELETE FROM users WHERE id = \? AND company_id = \?/);
  assert.match(block, /db\.transaction\(\(\) => \{/);
  assert.match(block, /action: 'user\.deleted'/);
  assert.match(block, /permanent: true/);
  assert.match(block, /You cannot delete your own account/);
  assert.match(block, /System Administrator account is protected/);
  assert.doesNotMatch(block, /UPDATE users SET is_active=0/);
});

test('user management UI exposes edit, separate deactivate/reactivate, and permanent delete actions', () => {
  const ui = read('public/js/pages/users.js');
  assert.match(ui, /data-edit-user/);
  assert.match(ui, /function openEditUserModal\(user\)/);
  assert.match(ui, /method:'PATCH'.*JSON\.stringify\(formData\)/s);
  assert.match(ui, /data-user-status/);
  assert.match(ui, /data-delete-user/);
  assert.match(ui, /PERMANENTLY DELETE/);
  assert.match(ui, /Deactivate/);
  assert.match(ui, /Reactivate/);
});

test('audit log deletion anonymizes only the deleted actor reference', () => {
  const schema = read('server/database/schema.sql');
  const migration = read('server/database/database.js');
  assert.match(schema, /OLD\.user_id IS NOT NULL AND NEW\.user_id IS NULL/);
  assert.match(schema, /NEW\.details_json IS OLD\.details_json/);
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_audit_logs_no_update/);
  assert.match(migration, /NEW\.created_at IS OLD\.created_at/);
  assert.match(schema, /trg_audit_logs_no_delete BEFORE DELETE ON audit_logs/);
});
