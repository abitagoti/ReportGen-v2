const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-payroll-pay-'));

const express = require('express');
const { db } = require('../server/database/database');
const { cookieMiddleware } = require('../server/lib/cookies');
const { createSession } = require('../server/auth/sessionService');
const { requireAuth } = require('../server/auth/middleware');
const { hashPassword } = require('../server/auth/passwordService');
const { savePermissions } = require('../server/permissions');

// Regression tests for the payroll payment / reconciliation flow:
//  1. Saving a payroll must never zero the entries (empty / missing amounts are rejected, totals derived server-side).
//  2. A payroll with payment records can never be deleted (history is preserved), by route or by the database.
//  3. Payments: overpayment needs explicit confirmation, exact settlement locks, retries are idempotent,
//     mistakes are voided (never deleted) with a reason, and voiding re-opens a locked payroll.
//  4. Money maths is rounded: float sums must still settle a payroll.
//  5. Edits cannot push the payroll total below what has already been paid.

const now = new Date().toISOString();
let server, base, cookie;
let monthCounter = 0;
const ALL = ['dashboard.view', 'staff.view', 'staff.manage', 'payroll.view', 'payroll.salaries', 'payroll.create', 'payroll.edit', 'payroll.finalize', 'payroll.deductions', 'payroll.loans'];

test.before(async () => {
  db.pragma('foreign_keys=OFF');
  db.prepare(`INSERT INTO companies (id,name,currency,created_at,updated_at) VALUES ('co1','Test Co','NGN',?,?)`).run(now, now);
  db.prepare(`INSERT INTO users (id,company_id,username,display_name,password_hash,role,created_at,updated_at) VALUES ('u_admin','co1','admin','admin',?,'administrator',?,?)`).run(hashPassword('CorrectHorse1!'), now, now);
  cookie = `reportgen_session=${createSession('u_admin').token}`;
  db.prepare(`INSERT INTO businesses (id,company_id,name,created_at,updated_at) VALUES ('b1','co1','Biz',?,?)`).run(now, now);
  for (const [id, name] of [['e1', 'Ada'], ['e2', 'Bola']]) db.prepare(`INSERT INTO payroll_employees(id,company_id,business_id,employee_code,employee_name,base_salary,status,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, 'co1', 'b1', 'S' + id, name, 100000, 'active', 1, now, now);
  savePermissions('co1', 'administrator', ALL, 'u_admin');
  const app = express();
  app.use(express.json());
  app.use(cookieMiddleware);
  app.use('/api', requireAuth);
  app.use(require('../server/payroll/payrollRoutes'));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

const call = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async r => { const text = await r.text(); let json = {}; try { json = JSON.parse(text); } catch {} return { status: r.status, json }; });

// Seeds a saved employee-mode payroll for a fresh month. `nets` = net amount per employee entry.
function seed(nets, { status = 'saved' } = {}) {
  const month = `2030-${String(++monthCounter).padStart(2, '0')}`;
  const pid = 'pay_' + month;
  db.prepare(`INSERT INTO payroll_monthly_totals(id,company_id,business_id,payroll_month,amount,calculation_mode,status,payment_status,created_at,updated_at) VALUES(?,?,?,?,0,'employees',?,'unpaid',?,?)`).run(pid, 'co1', 'b1', month, status, now, now);
  const entries = nets.map((net, i) => {
    const eid = 'pe_' + month + '_' + i;
    db.prepare(`INSERT INTO payroll_entries(id,company_id,business_id,employee_id,payroll_month,gross_amount,deductions,deduction_amount,loan_repayment_amount,net_amount,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,0,0,0,?,?,?,?)`).run(eid, 'co1', 'b1', i === 0 ? 'e1' : 'e2', month, net, net, 'u_admin', now, now);
    return eid;
  });
  return { month, pid, entries };
}
const entryRow = id => db.prepare('SELECT gross_amount AS gross,deductions,net_amount AS net FROM payroll_entries WHERE id=?').get(id);
const payroll = pid => db.prepare('SELECT payment_status AS paymentStatus,paid_at AS paidAt FROM payroll_monthly_totals WHERE id=?').get(pid);
const pay = (pid, amount, extra = {}, key) => call('POST', `/api/payroll/${pid}/payments`, { amount, paymentDate: '2030-06-15', ...extra }, key ? { 'Idempotency-Key': key } : {});

// ---------- 1. Saving must never zero a payroll ----------
test('the detail page never reads form fields that do not exist (zeroing regression)', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public/js/pages/payroll.js'), 'utf8');
  const fn = ui.slice(ui.indexOf('async function savePayrollDetail'), ui.indexOf('function payrollExportRows'));
  assert.ok(!/querySelector\(`\[name="gross/.test(fn) && !/entries:rows/.test(fn), 'savePayrollDetail must not rebuild amounts from the DOM');
  assert.ok(/\/save`/.test(fn), 'saving a draft calls the finalize endpoint only');
  assert.ok(!/window\.(prompt|alert)/.test(ui), 'payments use dialogs with confirmation, not window.prompt/alert');
});

test('PATCH with no entries, or an entry without a gross amount, is rejected and changes nothing', async () => {
  const { pid, entries } = seed([90000, 60000]);
  assert.equal((await call('PATCH', `/api/payroll/${pid}`, { entries: [] })).status, 400);
  assert.equal((await call('PATCH', `/api/payroll/${pid}`, {})).status, 400);
  assert.equal((await call('PATCH', `/api/payroll/${pid}`, { entries: [{ id: entries[0] }] })).status, 400);
  assert.equal(entryRow(entries[0]).net, 90000);
  assert.equal(entryRow(entries[1]).net, 60000);
});

test('PATCH derives deductions and net on the server and tolerates float amounts', async () => {
  const { pid, entries } = seed([100000]);
  const r = await call('PATCH', `/api/payroll/${pid}`, { entries: [{ id: entries[0], grossAmount: 100000, deductionAmount: 0.1, loanRepaymentAmount: 0.2, deductions: 0.3 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = entryRow(entries[0]);
  assert.equal(row.deductions, 0.3);
  assert.equal(row.net, 99999.7);
  const bad = await call('PATCH', `/api/payroll/${pid}`, { entries: [{ id: entries[0], grossAmount: 100, deductionAmount: 10, loanRepaymentAmount: 0, deductions: 50 }] });
  assert.equal(bad.status, 400, 'a client-supplied total that disagrees with its parts is refused');
});

test('PATCH only replaces loan repayments of the staff it edits', async () => {
  const { pid, entries, month } = seed([100000, 100000]);
  for (const [loan, staff] of [['l1', 'e1'], ['l2', 'e2']]) {
    db.prepare(`INSERT INTO payroll_staff_loans(id,company_id,staff_id,principal_amount,monthly_amount,start_month,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'active','u_admin',?,?)`).run(loan + month, 'co1', staff, 50000, 5000, '2030-01', now, now);
    db.prepare(`INSERT INTO payroll_loan_repayments(id,company_id,loan_id,staff_id,business_id,payroll_month,amount,status,created_by,created_at) VALUES(?,?,?,?,?,?,5000,'posted','u_admin',?)`).run('r' + loan + month, 'co1', loan + month, staff, 'b1', month, now);
  }
  const r = await call('PATCH', `/api/payroll/${pid}`, { entries: [{ id: entries[0], grossAmount: 100000, deductionAmount: 0, loanRepaymentAmount: 5000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const left = db.prepare(`SELECT staff_id AS s,status FROM payroll_loan_repayments WHERE payroll_month=? ORDER BY staff_id`).all(month);
  assert.deepEqual(left.map(x => x.s), ['e1', 'e2'], "the other employee's repayment is untouched");
  assert.ok(left.every(x => x.status === 'posted'));
});

// ---------- 2. Payment history is never discarded ----------
test('a payroll with payment records cannot be deleted by the route or directly in the database', async () => {
  const { pid } = seed([100000]);
  assert.equal((await pay(pid, 40000)).status, 201);
  const del = await call('DELETE', `/api/payroll/${pid}`);
  assert.equal(del.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payroll_payments WHERE payroll_id=?').get(pid).n, 1, 'payment still there');
  assert.ok(db.prepare('SELECT id FROM payroll_monthly_totals WHERE id=?').get(pid), 'payroll still there');
  assert.throws(() => db.prepare('DELETE FROM payroll_monthly_totals WHERE id=?').run(pid), /payment records/);
});

test('deleting an unpaid payroll with no payments still works and leaves no orphan manual adjustments', async () => {
  const { pid, month } = seed([100000]);
  db.prepare(`INSERT INTO payroll_manual_staff_adjustments(id,company_id,business_id,staff_id,payroll_month,gross_amount,deduction_amount,loan_repayment_amount,net_amount,created_by,created_at,updated_at) VALUES('ma_${month}','co1','b1','e1',?,1000,0,0,1000,'u_admin',?,?)`).run(month, now, now);
  assert.equal((await call('DELETE', `/api/payroll/${pid}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payroll_manual_staff_adjustments WHERE payroll_month=?').get(month).n, 0);
  const list = await call('GET', `/api/payroll/monthly?month=${month}`);
  assert.equal(list.json.businesses[0].payrollTotal, 0, 'a deleted payroll shows no phantom amount');
});

test('payment ledger columns exist (older installs are migrated)', () => {
  const cols = db.prepare('PRAGMA table_info(payroll_payments)').all().map(c => c.name);
  for (const c of ['status', 'voided_at', 'voided_by', 'void_reason']) assert.ok(cols.includes(c), c);
});

// ---------- 3. Payments: overpayment, locking, idempotency, voiding ----------
test('partial payment leaves a balance; overpayment needs explicit confirmation', async () => {
  const { pid } = seed([100000]);
  const first = await pay(pid, 60000);
  assert.equal(first.status, 201);
  assert.equal(payroll(pid).paymentStatus, 'unpaid');
  const over = await pay(pid, 50000);
  assert.equal(over.status, 409);
  assert.equal(over.json.code, 'OVERPAYMENT');
  assert.equal(over.json.balance, 40000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payroll_payments WHERE payroll_id=?').get(pid).n, 1, 'nothing recorded without confirmation');
  const ok = await pay(pid, 50000, { confirmOverpayment: true });
  assert.equal(ok.status, 201);
  assert.equal(payroll(pid).paymentStatus, 'paid');
  assert.equal((await call('GET', `/api/payroll/${pid}/payments`)).json.overpayment, 10000);
});

test('an exact settlement locks the payroll and further payments are refused', async () => {
  const { pid } = seed([100000]);
  assert.equal((await pay(pid, 100000)).status, 201);
  assert.equal(payroll(pid).paymentStatus, 'paid');
  assert.equal((await pay(pid, 1)).status, 409);
});

test('float sums settle a payroll (ten payments of 100000.10 against 1000001)', async () => {
  const { pid } = seed([1000001]);
  for (let i = 0; i < 10; i++) assert.equal((await pay(pid, 100000.1)).status, 201, `payment ${i + 1}`);
  assert.equal(payroll(pid).paymentStatus, 'paid');
  assert.equal((await call('GET', `/api/payroll/${pid}/payments`)).json.paid, 1000001);
});

test('payments are idempotent: the same key twice records one payment', async () => {
  const { pid } = seed([100000]);
  const a = await pay(pid, 25000, {}, 'pay-key-0000001');
  const b = await pay(pid, 25000, {}, 'pay-key-0000001');
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payroll_payments WHERE payroll_id=?').get(pid).n, 1);
});

test('bad payment input is rejected (sub-kobo amount, impossible date, draft payroll)', async () => {
  const { pid } = seed([100000]);
  assert.equal((await pay(pid, 0.001)).status, 400);
  assert.equal((await pay(pid, 100, { paymentDate: '2030-02-31' })).status, 400);
  const draft = seed([100000], { status: 'draft' });
  assert.equal((await pay(draft.pid, 100)).status, 409);
});

test('voiding keeps the record, needs a reason, excludes it from totals and re-opens a paid payroll', async () => {
  const { pid } = seed([100000]);
  const made = await pay(pid, 100000);
  assert.equal(payroll(pid).paymentStatus, 'paid');
  const paymentId = made.json.paymentId;
  assert.equal((await call('POST', `/api/payroll/${pid}/payments/${paymentId}/void`, { reason: '' })).status, 400);
  const voided = await call('POST', `/api/payroll/${pid}/payments/${paymentId}/void`, { reason: 'Typed the wrong amount' });
  assert.equal(voided.status, 200);
  assert.equal(voided.json.payrollReopened, true);
  assert.deepEqual(payroll(pid), { paymentStatus: 'unpaid', paidAt: null });
  assert.equal(db.prepare('SELECT status FROM payroll_payments WHERE id=?').get(paymentId).status, 'voided', 'row kept, marked voided');
  const hist = (await call('GET', `/api/payroll/${pid}/payments`)).json;
  assert.equal(hist.paid, 0);
  assert.equal(hist.outstanding, 100000);
  assert.equal(hist.payments.length, 1);
  assert.equal(hist.payments[0].voidReason, 'Typed the wrong amount');
  assert.equal((await call('POST', `/api/payroll/${pid}/payments/${paymentId}/void`, { reason: 'again' })).status, 409);
  // the monthly list ignores voided payments too
  const monthly = (await call('GET', `/api/payroll/monthly?month=${db.prepare('SELECT payroll_month m FROM payroll_monthly_totals WHERE id=?').get(pid).m}`)).json.businesses[0];
  assert.equal(monthly.amountPaid, 0);
  assert.equal(monthly.outstanding, 100000);
  // the audit trail records the void
  assert.ok(db.prepare(`SELECT 1 FROM audit_logs WHERE action='payroll.payment.voided' AND entity_id=?`).get(paymentId));
});

test('Mark Paid records only the remaining balance, and refuses a zero-value payroll', async () => {
  const { pid } = seed([100000]);
  assert.equal((await pay(pid, 30000)).status, 201);
  const mark = await call('POST', `/api/payroll/${pid}/paid`);
  assert.equal(mark.status, 200);
  assert.equal(mark.json.reconciledAmount, 70000);
  assert.equal((await call('GET', `/api/payroll/${pid}/payments`)).json.paid, 100000);
  const empty = seed([0]);
  const refused = await call('POST', `/api/payroll/${empty.pid}/paid`);
  assert.equal(refused.status, 400);
  assert.equal(payroll(empty.pid).paymentStatus, 'unpaid');
});

// ---------- 4/5. Edits cannot undercut what was paid ----------
test('an edit that would drop the payroll below the amount already paid is rolled back', async () => {
  const { pid, entries } = seed([100000]);
  assert.equal((await pay(pid, 80000)).status, 201);
  const r = await call('PATCH', `/api/payroll/${pid}`, { entries: [{ id: entries[0], grossAmount: 50000, deductionAmount: 0, loanRepaymentAmount: 0 }] });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /payments already recorded/);
  assert.equal(entryRow(entries[0]).net, 100000, 'entry unchanged after the rollback');
  // an edit that lands exactly on the paid amount settles and locks it
  const ok = await call('PATCH', `/api/payroll/${pid}`, { entries: [{ id: entries[0], grossAmount: 80000, deductionAmount: 0, loanRepaymentAmount: 0 }] });
  assert.equal(ok.status, 200);
  assert.equal(payroll(pid).paymentStatus, 'paid');
});

test('monthly list uses one definition of payable and real payments for each business', async () => {
  const { pid, month } = seed([70000, 30000]);
  assert.equal((await pay(pid, 25000)).status, 201);
  const row = (await call('GET', `/api/payroll/monthly?month=${month}`)).json.businesses[0];
  assert.equal(row.payrollTotal, 100000);
  assert.equal(row.amountPaid, 25000);
  assert.equal(row.outstanding, 75000);
  assert.equal(row.overpayment, 0);
});
