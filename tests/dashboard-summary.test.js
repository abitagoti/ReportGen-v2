const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
// Must be set before server/config is required anywhere in this process.
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-dash-'));

const express = require('express');
const { db } = require('../server/database/database');
const { cookieMiddleware } = require('../server/lib/cookies');
const { createSession } = require('../server/auth/sessionService');
const { hashPassword } = require('../server/auth/passwordService');
const dashboardRoutes = require('../server/dashboard/dashboardRoutes');

const now = new Date().toISOString();
let server, base, adminCookie, viewerCookie, ownerCookie;

test.before(async () => {
  db.pragma('foreign_keys=OFF');
  db.prepare(`INSERT INTO companies (id,name,currency,created_at,updated_at) VALUES ('co1','Test Co','NGN',?,?)`).run(now, now);
  const user = (id, name, role) => db.prepare(`INSERT INTO users (id,company_id,username,display_name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(id, 'co1', name, name, hashPassword('Passw0rd!234'), role, now, now);
  user('u_admin', 'admin1', 'administrator');
  user('u_view', 'viewer1', 'viewer');
  user('u_owner', 'owner1', 'owner');
  db.prepare(`INSERT INTO businesses (id,company_id,name,created_at,updated_at) VALUES ('b1','co1','pizzaHub',?,?)`).run(now, now);
  db.prepare(`INSERT INTO sales_imports (id,company_id,business_id,file_name,file_type,period_start,period_end,status,created_at) VALUES ('imp1','co1','b1','x.xls','xls','2026-07-01','2026-09-30','completed',?)`).run(now);
  const tx = db.prepare(`INSERT INTO sales_transactions (id,company_id,business_id,import_id,transaction_id,transaction_date,sales_amount,gross_amount,cost_amount,source_file,source_row,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  ['2026-07-31', '2026-08-01', '2026-08-15', '2026-08-31', '2026-09-01'].forEach((d, i) => tx.run(`t${i}`, 'co1', 'b1', 'imp1', `T${i}`, d, 1000, 1000, 600, 'x', i + 1, now));
  db.prepare(`INSERT INTO vendor_payments (id,company_id,business_id,payment_date,amount,created_at,updated_at) VALUES ('vp1','co1','b1','2026-08-10',777000,?,?)`).run(now, now);

  const ownerDefault=db.prepare(`INSERT INTO dashboard_owner_defaults (id,company_id,month,percent,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`);
  ownerDefault.run('od7','co1','2026-07',10,'u_admin',now,now);
  ownerDefault.run('od8','co1','2026-08',20,'u_admin',now,now);
  ownerDefault.run('od9','co1','2026-09',30,'u_admin',now,now);
  db.prepare(`INSERT INTO dashboard_owner_adjustments (id,company_id,business_id,month,percent,created_by,created_at,updated_at,excluded) VALUES (?,?,?,?,?,?,?,?,?)`).run('oa8','co1','b1','2026-08',25,'u_admin',now,now,0);

  const pay = db.prepare(`INSERT INTO payroll_monthly_totals (id,company_id,business_id,payroll_month,amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
  pay.run('pm7', 'co1', 'b1', '2026-07', 100, 'saved', now, now);
  pay.run('pm8', 'co1', 'b1', '2026-08', 200, 'saved', now, now);
  pay.run('pm9', 'co1', 'b1', '2026-09', 400, 'saved', now, now);
  pay.run('pm9d', 'co1', 'b1', '2026-10', 800, 'draft', now, now);

  adminCookie = `reportgen_session=${createSession('u_admin').token}`;
  viewerCookie = `reportgen_session=${createSession('u_view').token}`;
  ownerCookie = `reportgen_session=${createSession('u_owner').token}`;

  const app = express();
  app.use(express.json());
  app.use(cookieMiddleware);
  app.use(dashboardRoutes);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => { server?.close(); });

const get = async (query, cookie) => {
  const res = await fetch(`${base}/api/dashboard/summary?${query}`, { headers: { cookie } });
  return { status: res.status, body: await res.json() };
};

test('dashboard summary responds 200 and aggregates a full month', async () => {
  // Owner expense allocation is Owner-only (Stage 5), so the owner-expense
  // assertions in this test must run as the owner.
  const { status, body } = await get('month=2026-08', ownerCookie);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.totals.sales, 3000);
  assert.equal(body.totals.costOfGoods, 1800);
  assert.equal(body.totals.grossProfit, 1200);
  assert.equal(body.totals.transactions, 3);
  assert.equal(body.fullMonth, true);
  assert.equal(typeof body.ownerAllocation.defaultPercent, 'number');
  assert.equal(body.totals.ownerExpense, 300);
  assert.equal(body.ownerAllocation.months.length, 1);
  assert.equal(body.ownerAllocation.months[0].defaultPercent, 20);
  assert.equal(body.ownerAllocation.months[0].businesses[0].percent, 25);
});

test('calendar range is inclusive of both end dates and does not leak neighbouring days', async () => {
  const { body } = await get('month=2026-08&start=2026-08-15&end=2026-08-31', adminCookie);
  assert.equal(body.totals.transactions, 2);
  assert.equal(body.totals.sales, 2000);
  assert.equal(body.fullMonth, false);
});

test('a range spanning two months returns rows from both', async () => {
  const { body } = await get('month=2026-08&start=2026-07-25&end=2026-09-05', adminCookie);
  assert.equal(body.totals.transactions, 5);
});

test('owner expense uses each calendar month percentage across a multi-month range', async () => {
  const { body } = await get('month=2026-07&start=2026-07-25&end=2026-09-05', ownerCookie);
  assert.equal(body.ownerAllocation.months.length, 3);
  assert.deepEqual(body.ownerAllocation.months.map(x => [x.month, x.defaultPercent, x.businesses[0].percent, x.ownerExpense]), [
    ['2026-07', 10, 10, 40],
    ['2026-08', 20, 25, 300],
    ['2026-09', 30, 30, 120]
  ]);
  assert.equal(body.totals.ownerExpense, 460);
  assert.equal(body.totals.netProfit, body.totals.grossProfit - body.totals.expenses - body.totals.payroll - 460);
});

test('an inverted range is rejected', async () => {
  const { status } = await get('month=2026-08&start=2026-08-31&end=2026-08-01', adminCookie);
  assert.equal(status, 400);
});

test('a month with no data returns zeros, not an error', async () => {
  const { status, body } = await get('month=2026-10', adminCookie);
  assert.equal(status, 200);
  assert.equal(body.totals.sales, 0);
});

test('a user with no business access cannot see company-wide vendor payments', async () => {
  const viewer = await get('month=2026-08', viewerCookie);
  assert.equal(viewer.status, 200);
  assert.equal(viewer.body.totals.vendorPayments, 0);
  assert.equal(viewer.body.totals.vendorPaymentCount, 0);
  const admin = await get('month=2026-08', adminCookie);
  assert.equal(admin.body.totals.vendorPayments, 777000);
});

test('requesting a business the user cannot access is forbidden', async () => {
  const { status } = await get('month=2026-08&businessId=b1', viewerCookie);
  assert.equal(status, 403);
});

test('payroll for a partial range inside one month is the full month figure, not pro-rated', async () => {
  const { body } = await get('month=2026-08&start=2026-08-15&end=2026-08-31', adminCookie);
  assert.equal(body.totals.payroll, 200);
});

test('payroll sums every month the range touches', async () => {
  const { body } = await get('month=2026-07&start=2026-07-25&end=2026-09-05', adminCookie);
  assert.equal(body.totals.payroll, 100 + 200 + 400);
  assert.equal(body.totals.netProfit, body.totals.grossProfit - body.totals.expenses - 700 - body.totals.ownerExpense);
});

test('draft payroll is never counted', async () => {
  const { body } = await get('month=2026-10', adminCookie);
  assert.equal(body.totals.payroll, 0);
});

// Regression: owner allocation is enforced on the server, not just hidden in the UI.
test('non-owner roles receive no owner allocation data and net profit is computed before it', async () => {
  for (const [label, cookie] of [['administrator', adminCookie], ['viewer', viewerCookie]]) {
    const { status, body } = await get('month=2026-07&start=2026-07-25&end=2026-09-05', cookie);
    assert.equal(status, 200, label);
    assert.equal(body.ownerAllocation, null, `${label} must not receive ownerAllocation`);
    assert.equal(body.totals.ownerExpense, 0, `${label} ownerExpense must be 0`);
    assert.equal(JSON.stringify(body).includes('defaultPercent'), false, `${label} response leaks allocation percentages`);
    assert.equal(body.totals.netProfit, body.totals.grossProfit - body.totals.expenses - body.totals.payroll, label);
  }
});

test('owner expense across a multi-month range equals the sum of per-month expense and each percent is applied to that month only', async () => {
  const { body } = await get('month=2026-07&start=2026-07-25&end=2026-09-05', ownerCookie);
  const sum = body.ownerAllocation.months.reduce((a, m) => a + m.ownerExpense, 0);
  assert.equal(sum, body.totals.ownerExpense);
  assert.equal(body.ownerAllocation.totalExpense, body.totals.ownerExpense);
});
