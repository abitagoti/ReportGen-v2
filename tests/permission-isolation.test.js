const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-perm-'));

const express = require('express');
const { db } = require('../server/database/database');
const { cookieMiddleware } = require('../server/lib/cookies');
const { createSession } = require('../server/auth/sessionService');
const { requireAuth } = require('../server/auth/middleware');
const { hashPassword } = require('../server/auth/passwordService');
const { savePermissions, PERMISSIONS } = require('../server/permissions');

// Each permission must open ONLY its own area. Salaries are their own permission (payroll.salaries).
const now = new Date().toISOString();
const SALARY = 250000;
let server, base;
const cookie = {};

test.before(async () => {
  db.pragma('foreign_keys=OFF');
  db.prepare(`INSERT INTO companies (id,name,currency,created_at,updated_at) VALUES ('co1','Test Co','NGN',?,?)`).run(now, now);
  for (const role of ['administrator', 'general_manager', 'business_manager', 'accountant']) {
    db.prepare(`INSERT INTO users (id,company_id,username,display_name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('u_' + role, 'co1', role, role, hashPassword('CorrectHorse1!'), role, now, now);
    cookie[role] = `reportgen_session=${createSession('u_' + role).token}`;
  }
  db.prepare(`INSERT INTO businesses (id,company_id,name,created_at,updated_at) VALUES ('b1','co1','Biz',?,?)`).run(now, now);
  db.prepare(`INSERT INTO user_business_access (user_id,business_id,created_at) VALUES ('u_business_manager','b1',?)`).run(now);
  db.prepare(`INSERT INTO user_business_access (user_id,business_id,created_at) VALUES ('u_accountant','b1',?)`).run(now);
  db.prepare(`INSERT INTO payroll_employees(id,company_id,business_id,employee_code,employee_name,base_salary,status,is_active,created_at,updated_at) VALUES('e1','co1','b1','S001','Ada',?,'active',1,?,?)`).run(SALARY, now, now);
  db.prepare(`INSERT INTO payroll_staff_deductions(id,company_id,staff_id,amount,category,start_month,created_by,created_at,updated_at) VALUES('d1','co1','e1',999,'Late',?,'u_administrator',?,?)`).run('2026-01', now, now);
  const app = express();
  app.use(express.json());
  app.use(cookieMiddleware);
  app.use('/api', requireAuth);
  for (const mod of ['businesses/businessRoutes', 'payroll/payrollRoutes', 'organizationRoutes', 'accountant/accountantRoutes']) app.use(require('../server/' + mod));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

const call = (role, method, url, body) => fetch(base + url, { method, headers: { cookie: cookie[role], 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, text: await r.text() }));
const grant = (role, perms) => savePermissions('co1', role, perms, 'u_administrator');

for (const role of ['general_manager', 'business_manager']) {
  test(`${role}: staff.view alone shows the staff list with no salary, payroll or deductions`, async () => {
    grant(role, ['dashboard.view', 'staff.view']);
    const staff = await call(role, 'GET', '/api/payroll/staff');
    assert.equal(staff.status, 200);
    assert.ok(staff.text.includes('Ada'));
    assert.ok(!staff.text.includes(String(SALARY)), 'salary must not be exposed');
    for (const url of ['/api/payroll/monthly?month=2026-10', '/api/payroll/entries?businessId=b1&month=2026-10', '/api/payroll/deductions?month=2026-10', '/api/payroll/loans', '/api/payroll/manual-checklist?businessId=b1&month=2026-10'])
      assert.equal((await call(role, 'GET', url)).status, 403, url);
  });

  test(`${role}: payroll.view alone gives totals only, no salaries, no deductions`, async () => {
    grant(role, ['dashboard.view', 'payroll.view']);
    assert.equal((await call(role, 'GET', '/api/payroll/monthly?month=2026-10')).status, 200);
    assert.equal((await call(role, 'GET', '/api/payroll/entries?businessId=b1&month=2026-10')).status, 403);
    assert.equal((await call(role, 'GET', '/api/payroll/deductions?month=2026-10')).status, 403);
    const staff = await call(role, 'GET', '/api/payroll/staff');
    assert.ok(!staff.text.includes(String(SALARY)));
  });

  test(`${role}: payroll.deductions alone can list deductions and pick staff, without salaries`, async () => {
    grant(role, ['dashboard.view', 'payroll.deductions']);
    assert.equal((await call(role, 'GET', '/api/payroll/deductions?month=2026-10')).status, 200);
    const staff = await call(role, 'GET', '/api/payroll/staff');
    assert.equal(staff.status, 200);
    assert.ok(!staff.text.includes(String(SALARY)));
    assert.equal((await call(role, 'GET', '/api/payroll/monthly?month=2026-10')).status, 403);
  });

  test(`${role}: payroll.salaries unlocks salaries and per-employee pay`, async () => {
    grant(role, ['dashboard.view', 'staff.view', 'payroll.view', 'payroll.salaries']);
    assert.ok((await call(role, 'GET', '/api/payroll/staff')).text.includes(String(SALARY)));
    assert.equal((await call(role, 'GET', '/api/payroll/entries?businessId=b1&month=2026-10')).status, 200);
  });
}

test('staff.manage without payroll.salaries cannot read, set or change salaries', async () => {
  grant('general_manager', ['dashboard.view', 'staff.view', 'staff.manage']);
  const created = await call('general_manager', 'POST', '/api/payroll/staff', { businessId: 'b1', employeeName: 'Bola', baseSalary: 777777 });
  assert.equal(created.status, 201);
  const row = db.prepare(`SELECT base_salary AS s FROM payroll_employees WHERE employee_name='Bola'`).get();
  assert.equal(row.s, 0, 'a salary typed by someone without the salary permission is ignored');
  const edit = await call('general_manager', 'PATCH', '/api/payroll/staff/e1', { employeeName: 'Ada', businessId: 'b1', baseSalary: 1 });
  assert.equal(edit.status, 200);
  assert.equal(db.prepare(`SELECT base_salary AS s FROM payroll_employees WHERE id='e1'`).get().s, SALARY, 'existing salary is left unchanged');
  assert.equal((await call('general_manager', 'POST', '/api/payroll/staff/salary-increase', { staffIds: ['e1'], amount: 5 })).status, 403);
});

test('departments and job roles follow staff.manage, not the role name', async () => {
  grant('general_manager', ['dashboard.view', 'staff.view']);
  assert.equal((await call('general_manager', 'POST', '/api/organization/departments', { name: 'Ops' })).status, 403);
  grant('general_manager', ['dashboard.view', 'staff.view', 'staff.manage']);
  assert.equal((await call('general_manager', 'POST', '/api/organization/departments', { name: 'Ops' })).status, 201);
});



test('accountant financial mutations respect expenses permissions', async () => {
  grant('accountant', ['dashboard.view', 'expenses.view']);
  assert.equal((await call('accountant', 'GET', '/api/accountant/expenses?month=2026-10')).status, 200);
  assert.equal((await call('accountant', 'GET', '/api/accountant/remittances?month=2026-10&businessId=b1')).status, 200);
  assert.equal((await call('accountant', 'POST', '/api/accountant/expenses', { businessId: 'b1', expenseDate: '2026-10-05', category: 'Test', amount: 100 })).status, 403);
  assert.equal((await call('accountant', 'POST', '/api/accountant/remittances', { businessId: 'b1', remittanceDate: '2026-10-05', amount: 100 })).status, 403);
  assert.equal((await call('accountant', 'POST', '/api/accountant/expense-templates', { name: 'Test item' })).status, 403);
  grant('accountant', ['dashboard.view', 'expenses.manage']);
  assert.equal((await call('accountant', 'GET', '/api/accountant/expenses?month=2026-10')).status, 403);
  assert.equal((await call('accountant', 'POST', '/api/accountant/expenses', { businessId: 'b1', expenseDate: '2026-10-05', category: 'Test', amount: 100 })).status, 201);
  assert.equal((await call('accountant', 'POST', '/api/accountant/remittances', { businessId: 'b1', remittanceDate: '2026-10-05', amount: 100 })).status, 201);
});

test('the salary permission is in the catalog', () => {
  assert.ok(PERMISSIONS.some(p => p[0] === 'payroll.salaries'));
});

// savePermissions() writes a row for EVERY permission, so earlier tests leave rows
// behind for co1. The migration tests therefore use their own company and roles.
function seedCompanyPermissions(companyId, rows) {
  db.prepare(`INSERT OR IGNORE INTO companies (id,name,currency,created_at,updated_at) VALUES (?,?,'NGN',?,?)`).run(companyId, companyId, now, now);
  const put = db.prepare(`INSERT INTO role_permissions(id,company_id,role,permission,enabled,updated_by,updated_at) VALUES(?,?,?,?,?,NULL,?)`);
  rows.forEach(([role, perm, enabled], i) => put.run(`seed_${companyId}_${i}`, companyId, role, perm, enabled, now));
}
const salaryRows = (companyId, role) => db.prepare(`SELECT enabled FROM role_permissions WHERE company_id=? AND role=? AND permission='payroll.salaries'`).all(companyId, role).map(r => r.enabled);

test('migration seeds payroll.salaries from payroll.view for roles that already have saved permissions', () => {
  const { migrateSalaryPermission } = require('../server/database/database');
  seedCompanyPermissions('co_mig1', [['accountant', 'payroll.view', 1], ['viewer', 'payroll.view', 0]]);
  migrateSalaryPermission();
  migrateSalaryPermission(); // idempotent
  assert.deepEqual(salaryRows('co_mig1', 'accountant'), [1]);
  assert.deepEqual(salaryRows('co_mig1', 'viewer'), [0]);
});

// Regression: this migration runs on every server start. It must never undo an
// administrator's explicit decision to revoke salary access from a role that can
// still view payroll totals.
test('migration never overrides an explicit payroll.salaries decision', () => {
  const { migrateSalaryPermission } = require('../server/database/database');
  seedCompanyPermissions('co_mig2', [
    ['general_manager', 'payroll.view', 1], ['general_manager', 'payroll.salaries', 0],
    ['accountant', 'payroll.view', 0], ['accountant', 'payroll.salaries', 1]
  ]);
  migrateSalaryPermission();
  migrateSalaryPermission();
  assert.deepEqual(salaryRows('co_mig2', 'general_manager'), [0], 'revoked salary access must stay revoked');
  assert.deepEqual(salaryRows('co_mig2', 'accountant'), [1], 'explicit grant must not be downgraded');
});

// Regression: permissions are enforced on the server, not only hidden in the UI.
test('accountant routes reject unauthenticated callers and view-only users cannot delete expenses', async () => {
  const anon = await fetch(base + '/api/accountant/expenses?month=2026-10');
  assert.equal(anon.status, 401);
  grant('accountant', ['dashboard.view', 'expenses.manage', 'expenses.view']);
  const created = await call('accountant', 'POST', '/api/accountant/expenses', { businessId: 'b1', expenseDate: '2026-10-06', category: 'Delete me', amount: 50 });
  assert.equal(created.status, 201);
  const expenseId = JSON.parse(created.text).id || JSON.parse(created.text).expense?.id;
  assert.ok(expenseId, 'created expense id is returned');
  grant('accountant', ['dashboard.view', 'expenses.view']);
  assert.equal((await call('accountant', 'DELETE', `/api/accountant/expenses/${expenseId}`)).status, 403);
  const list = await call('accountant', 'GET', '/api/accountant/expenses?month=2026-10');
  assert.ok(list.text.includes('Delete me'), 'expense must still exist after the rejected delete');
});
