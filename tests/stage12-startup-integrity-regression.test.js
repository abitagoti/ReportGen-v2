// Regression for the 2.0.20 RC startup crash:
//   SqliteError: no such column: child.staff_id
// verifyDatabaseIntegrity() joined payroll_entries on staff_id, but that table
// stores the employee as employee_id. The server therefore could not start.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-integrity-'));

const { db } = require('../server/database/database'); // runs startup integrity check
const { verifyDatabaseIntegrity } = require('../server/database/integrity');
const now = new Date().toISOString();

test.before(() => {
  db.pragma('foreign_keys=OFF');
  for (const id of ['coA', 'coB']) db.prepare(`INSERT INTO companies (id,name,currency,created_at,updated_at) VALUES (?,?,?,?,?)`).run(id, id, 'NGN', now, now);
  db.prepare(`INSERT INTO businesses (id,company_id,name,created_at,updated_at) VALUES ('bA','coA','A',?,?)`).run(now, now);
  db.prepare(`INSERT INTO payroll_employees(id,company_id,business_id,employee_code,employee_name,base_salary,status,is_active,created_at,updated_at) VALUES('eA','coA','bA','S1','Ada',1000,'active',1,?,?)`).run(now, now);
  db.pragma('foreign_keys=ON');
});

test('every payroll child table checked by the integrity routine has a real staff/employee column', () => {
  for (const table of ['payroll_entries', 'payroll_staff_loans', 'payroll_staff_deductions', 'payroll_manual_staff_adjustments', 'payroll_loan_skips', 'payroll_loan_repayments']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    assert.ok(cols.includes('staff_id') || cols.includes('employee_id'), `${table} has no staff reference column`);
  }
  assert.doesNotThrow(() => verifyDatabaseIntegrity(db));
});

test('integrity check passes with a valid payroll entry and rejects a cross-company payroll entry', () => {
  db.prepare(`INSERT INTO payroll_entries(id,company_id,business_id,employee_id,payroll_month,gross_amount,deductions,net_amount,created_at,updated_at) VALUES('pe1','coA','bA','eA','2026-09',1000,0,1000,?,?)`).run(now, now);
  assert.doesNotThrow(() => verifyDatabaseIntegrity(db));
  db.pragma('foreign_keys=OFF');
  db.prepare(`UPDATE payroll_entries SET company_id='coB' WHERE id='pe1'`).run();
  assert.throws(() => verifyDatabaseIntegrity(db), /tenant-integrity|belongs to another company/i);
  db.prepare(`UPDATE payroll_entries SET company_id='coA' WHERE id='pe1'`).run();
  db.pragma('foreign_keys=ON');
});
