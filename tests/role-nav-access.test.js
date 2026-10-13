const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
// Must be set before server/config is required anywhere in this process.
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-nav-'));

const express = require('express');
const { db } = require('../server/database/database');
const { cookieMiddleware } = require('../server/lib/cookies');
const { createSession } = require('../server/auth/sessionService');
const { requireAuth } = require('../server/auth/middleware');
const { hashPassword } = require('../server/auth/passwordService');
const { PERMISSIONS, savePermissions } = require('../server/permissions');

// Regression guard: when an administrator switches a page's permission on for a role, the
// sidebar link appears (the client filters the nav by permission). The page's own API calls
// must then succeed for that role, scoped to the businesses the user is assigned to.
const now = new Date().toISOString();
const month = '2026-10', start = '2026-10-01', end = '2026-10-31';
const ROLES = ['owner', 'general_manager', 'accountant', 'business_manager', 'viewer'];
let server, base;
const cookies = {};

test.before(async () => {
  db.pragma('foreign_keys=OFF');
  db.prepare(`INSERT INTO companies (id,name,currency,created_at,updated_at) VALUES ('co1','Test Co','NGN',?,?)`).run(now, now);
  for (const role of [...ROLES, 'administrator']) {
    db.prepare(`INSERT INTO users (id,company_id,username,display_name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('u_' + role, 'co1', role, role, hashPassword('CorrectHorse1!'), role, now, now);
  }
  for (const [id, name] of [['b_ok', 'Assigned'], ['b_hidden', 'HiddenBiz']]) {
    db.prepare(`INSERT INTO businesses (id,company_id,name,created_at,updated_at) VALUES (?,?,?,?,?)`).run(id, 'co1', name, now, now);
    db.prepare(`INSERT INTO capital_contributions (id,company_id,business_id,period_start,period_end,amount,entry_mode,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('cap_' + id, 'co1', id, '2026-10-05', '2026-10-05', 1000, 'individual', 'cap-' + id, 'u_owner', now, now);
    db.prepare(`INSERT INTO vendor_payments (id,company_id,business_id,payment_date,amount,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('vp_' + id, 'co1', id, '2026-10-06', 500, 'vp-' + id, now, now);
  }
  for (const role of ['accountant', 'business_manager', 'viewer']) {
    db.prepare(`INSERT INTO user_business_access (user_id,business_id,created_at) VALUES (?,?,?)`).run('u_' + role, 'b_ok', now);
    // Every toggle on, except View salaries for the limited roles: salaries are their own permission.
    savePermissions('co1', role, PERMISSIONS.map(p => p[0]).filter(k => !(k === 'payroll.salaries' && role !== 'accountant')), 'u_administrator');
  }
  for (const role of ROLES) cookies[role] = `reportgen_session=${createSession('u_' + role).token}`;

  const app = express();
  app.use(express.json());
  app.use(cookieMiddleware);
  app.use('/api', requireAuth);
  for (const mod of ['businesses/businessRoutes', 'sales/salesRoutes', 'capital/capitalRoutes', 'vendor/vendorPaymentRoutes', 'payroll/payrollRoutes', 'accountant/accountantRoutes', 'reports/reportsRoutes', 'messages/messageRoutes', 'dashboard/dashboardRoutes', 'users/userRoutes', 'configuration/configurationRoutes', 'organizationRoutes', 'permissionsRoutes']) {
    app.use(require('../server/' + mod));
  }
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

const get = (role, url) => fetch(base + url, { headers: { cookie: cookies[role] } }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const post = (role, url, body) => fetch(base + url, { method: 'POST', headers: { cookie: cookies[role], 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// What each sidebar page requests when it opens, per workspace variant (see public/js/app.js render()).
function pageRequests(role) {
  const acct = role === 'accountant', limited = role === 'business_manager' || role === 'viewer';
  const q = `month=${month}&start=${start}&end=${end}`;
  return {
    dashboard: [['GET', acct ? `/api/accountant/monthly-summary?${q}` : `/api/dashboard/summary?${q}`]],
    businesses: [['GET', `/api/businesses?${q}`]],
    sales: [['GET', `/api/sales/summary?${q}`]],
    staff: [['GET', '/api/payroll/staff']],
    expenses: [['GET', (acct ? '/api/accountant/expenses' : limited ? '/api/manager/expenses' : '/api/owner/expenses') + `?${q}`]],
    purchases: [['GET', `/api/capital?start=${start}&end=${end}`]],
    'vendor-payments': [['GET', `/api/vendor-payments?start=${start}&end=${end}`]],
    payroll: [['GET', `/api/payroll/monthly?month=${month}`]],
    deductions: [['GET', `/api/payroll/deductions?month=${month}`], ['GET', '/api/payroll/staff']],
    comparison: [['GET', `/api/capital?start=${start}&end=${end}`], ['GET', `/api/businesses/b_ok/details?${q}`]],
    reports: [acct ? ['GET', `/api/accountant/monthly-summary?${q}`] : limited ? ['GET', `/api/businesses/b_ok/details?${q}`] : ['POST', '/api/reports/owner-data', { range: { start, end }, selectedBusinessId: null }]],
    messages: [['GET', '/api/messages'], ['GET', '/api/messages/recipients']],
    history: [['GET', '/api/sales/imports']],
    settings: [['GET', '/api/settings/configuration'], ['GET', '/api/organization/job-roles']],
    users: [['GET', '/api/users']]
  };
}

for (const role of ROLES) {
  test(`${role}: every page whose permission is enabled opens without a permission error`, async () => {
    for (const [page, requests] of Object.entries(pageRequests(role))) {
      for (const [method, url, body] of requests) {
        const res = method === 'POST' ? await post(role, url, body) : await get(role, url);
        assert.ok(res.status < 400, `${role} -> ${page} (${method} ${url}) returned ${res.status}: ${res.body?.error || ''}`);
      }
    }
  });
}

test('business manager dashboard does not expose purchases or capital planning', async () => {
  const res = await get('business_manager', `/api/dashboard/summary?month=${month}&start=${start}&end=${end}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.planning, null);
  assert.equal(Object.prototype.hasOwnProperty.call(res.body.totals || {}, 'purchases'), false);
});

test('limited roles only see their assigned business and no salaries', async () => {
  for (const role of ['viewer', 'business_manager', 'accountant']) {
    const cap = await get(role, `/api/capital?start=${start}&end=${end}`);
    assert.ok(cap.body.contributions.length === 1 || role === 'accountant', `${role} capital list must be scoped`);
    const vendor = await get(role, `/api/vendor-payments?start=${start}&end=${end}`);
    assert.equal(JSON.stringify(vendor.body).includes('vp-b_hidden'), false, `${role} must not see another business's vendor payments`);
    assert.equal((await get(role, '/api/businesses/b_hidden/details?month=' + month)).status, 403);
  }
  for (const role of ['viewer', 'business_manager']) {
    const staff = await get(role, '/api/payroll/staff');
    assert.ok(staff.body.staff.every(s => s.baseSalary === null), `${role} must not receive salaries`);
    assert.equal((await get(role, `/api/payroll/entries?businessId=b_ok&month=${month}`)).status, 403);
    assert.equal((await get(role, `/api/owner/expenses?${'month=' + month}`)).status, 403);
    assert.equal((await post(role, '/api/reports/owner-data', { range: { start, end } })).status, 403);
  }
});
