'use strict';

// Stage 10D database integrity guard.
// SQLite foreign keys prove that a referenced row exists, but they do not by
// themselves prove that a child row belongs to the same company as that row.
// These checks cover both SQLite-level integrity and ReportGen's tenant boundary.

const REQUIRED_TABLES = [
  'companies','users','businesses','user_business_access','sessions','audit_logs',
  'sales_imports','sales_transactions','sales_import_issues','accountant_expenses',
  'accountant_remittances','capital_contributions','vendor_payments','payroll_monthly_totals','payroll_payments',
  'payroll_employees','payroll_entries','payroll_staff_loans','payroll_loan_skips',
  'payroll_manual_staff_adjustments','payroll_loan_repayments','payroll_staff_deductions',
  'role_permissions','user_permission_overrides','idempotency_keys'
];

const REQUIRED_INDEXES = [
  'idx_users_company','idx_businesses_company','idx_access_user','idx_access_business',
  'idx_sales_import_business_period','idx_sales_tx_company_date_business',
  'idx_sales_tx_business_date','idx_sales_tx_import','idx_accountant_expenses_business_date',
  'idx_accountant_expenses_company_date_business','idx_capital_company_period',
  'idx_capital_business_period','idx_vendor_payments_company_date',
  'idx_vendor_payments_business_date','idx_payroll_monthly_company_period',
  'idx_payroll_monthly_business_period','idx_payroll_payments_company_payroll','idx_payroll_employees_business',
  'idx_payroll_entries_business_period','idx_staff_loans_staff','idx_user_permission_overrides_user',
  'idx_loan_skips_loan_month','idx_loan_skips_staff_month','idx_manual_staff_adjustments_period',
  'idx_loan_repayments_staff','idx_loan_repayments_business','idx_staff_deductions_staff',
  'idx_idempotency_updated'
];

const APPEND_ONLY_TRIGGERS = ['trg_audit_logs_no_update','trg_audit_logs_no_delete'];

const SAME_COMPANY_BUSINESS_TABLES = [
  'sales_transactions', 'accountant_expenses', 'accountant_remittances',
  'dashboard_owner_adjustments', 'payroll_monthly_totals', 'payroll_employees',
  'payroll_manual_staff_adjustments', 'payroll_loan_skips', 'payroll_loan_repayments'
];

function countRows(db, sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return Number(row?.n || 0);
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function indexExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name);
}

function triggerExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name);
}

function assertNoCrossCompanyBusinessRows(db, table) {
  if (!tableExists(db, table)) return;
  const count = countRows(db, `
    SELECT COUNT(*) AS n
    FROM ${table} child
    JOIN businesses b ON b.id = child.business_id
    WHERE child.company_id <> b.company_id
  `);
  if (count) throw new Error(`Database tenant-integrity failure: ${table} contains ${count} row(s) whose business belongs to another company.`);
}

// payroll_entries references the employee as employee_id; every other payroll
// child table uses staff_id. Keep this explicit so a schema change fails loudly
// in tests instead of at server startup.
const STAFF_REFERENCE_COLUMN = {
  payroll_entries: 'employee_id',
  payroll_staff_loans: 'staff_id',
  payroll_staff_deductions: 'staff_id',
  payroll_manual_staff_adjustments: 'staff_id',
  payroll_loan_skips: 'staff_id',
  payroll_loan_repayments: 'staff_id'
};

function assertNoCrossCompanyStaffRows(db, table) {
  if (!tableExists(db, table)) return;
  const column = STAFF_REFERENCE_COLUMN[table];
  if (!column) throw new Error(`Database integrity check has no staff reference column configured for ${table}.`);
  const count = countRows(db, `
    SELECT COUNT(*) AS n
    FROM ${table} child
    JOIN payroll_employees staff ON staff.id = child.${column}
    WHERE child.company_id <> staff.company_id
  `);
  if (count) throw new Error(`Database tenant-integrity failure: ${table} contains ${count} row(s) whose staff belongs to another company.`);
}

function assertNoCrossCompanyLoanRows(db, table) {
  if (!tableExists(db, table)) return;
  const count = countRows(db, `
    SELECT COUNT(*) AS n
    FROM ${table} child
    JOIN payroll_staff_loans loan ON loan.id = child.loan_id
    WHERE child.company_id <> loan.company_id
  `);
  if (count) throw new Error(`Database tenant-integrity failure: ${table} contains ${count} row(s) whose loan belongs to another company.`);
}

function verifyDatabaseIntegrity(db) {
  db.pragma('foreign_keys = ON');

  const fkMode = Number(db.pragma('foreign_keys', { simple: true }));
  if (fkMode !== 1) throw new Error('Database integrity failure: SQLite foreign_keys pragma is not enabled.');

  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (!integrity || String(Object.values(integrity)[0]) !== 'ok') {
    throw new Error(`Database integrity_check failed: ${JSON.stringify(integrity)}`);
  }

  const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
  if (fkErrors.length) {
    throw new Error(`Database foreign_key_check found ${fkErrors.length} violation(s): ${JSON.stringify(fkErrors.slice(0, 10))}`);
  }

  const missingTables = REQUIRED_TABLES.filter(name => !tableExists(db, name));
  if (missingTables.length) throw new Error(`Database integrity failure: required table(s) missing: ${missingTables.join(', ')}`);

  const missingIndexes = REQUIRED_INDEXES.filter(name => !indexExists(db, name));
  if (missingIndexes.length) throw new Error(`Database integrity failure: required index(es) missing: ${missingIndexes.join(', ')}`);

  const missingTriggers = APPEND_ONLY_TRIGGERS.filter(name => !triggerExists(db, name));
  if (missingTriggers.length) throw new Error(`Database integrity failure: required audit trigger(s) missing: ${missingTriggers.join(', ')}`);

  // A business is tenant-scoped. A normal FK only checks existence, so explicitly
  // reject rows whose company_id disagrees with their business's company_id.
  for (const table of SAME_COMPANY_BUSINESS_TABLES) assertNoCrossCompanyBusinessRows(db, table);

  // Payroll staff is also tenant-scoped and cannot cross company boundaries.
  for (const table of Object.keys(STAFF_REFERENCE_COLUMN)) {
    assertNoCrossCompanyStaffRows(db, table);
  }

  // Loan children must remain inside the loan's company as well.
  for (const table of ['payroll_loan_skips','payroll_loan_repayments']) assertNoCrossCompanyLoanRows(db, table);

  // Sales transactions inherit their business/import identity. All three company
  // values must agree so reporting cannot accidentally mix tenants.
  if (countRows(db, `
    SELECT COUNT(*) AS n FROM sales_transactions tx
    JOIN sales_imports imp ON imp.id=tx.import_id
    JOIN businesses b ON b.id=tx.business_id
    WHERE tx.company_id<>imp.company_id OR tx.company_id<>b.company_id OR imp.business_id<>tx.business_id
  `)) throw new Error('Database tenant-integrity failure: sales transaction/import/business ownership mismatch detected.');

  // User/business access is intentionally company-scoped even though its composite
  // primary key only contains user_id/business_id.
  if (countRows(db, `
    SELECT COUNT(*) AS n FROM user_business_access a
    JOIN users u ON u.id=a.user_id
    JOIN businesses b ON b.id=a.business_id
    WHERE u.company_id<>b.company_id
  `)) throw new Error('Database tenant-integrity failure: user/business access crosses company boundaries.');

  // Idempotency records must never be replayable across companies/users.
  if (countRows(db, `
    SELECT COUNT(*) AS n FROM idempotency_keys k
    JOIN users u ON u.id=k.user_id
    WHERE k.company_id<>u.company_id
  `)) throw new Error('Database tenant-integrity failure: idempotency record has a mismatched user/company scope.');

  // Payroll loan children also need their business to match the loan/staff company.
  if (countRows(db, `
    SELECT COUNT(*) AS n
    FROM payroll_loan_skips x
    JOIN businesses b ON b.id=x.business_id
    WHERE x.company_id<>b.company_id
  `)) throw new Error('Database tenant-integrity failure: payroll loan-skip business crosses company boundaries.');
  if (countRows(db, `
    SELECT COUNT(*) AS n
    FROM payroll_loan_repayments x
    JOIN businesses b ON b.id=x.business_id
    WHERE x.company_id<>b.company_id
  `)) throw new Error('Database tenant-integrity failure: payroll loan-repayment business crosses company boundaries.');

  // Historical payroll protection: staff/payroll history must not be deletable via
  // an accidental CASCADE. Every live staff FK must be RESTRICT.
  const payrollFkTables = [
    'payroll_entries','payroll_staff_loans','payroll_staff_deductions',
    'payroll_loan_skips','payroll_manual_staff_adjustments','payroll_loan_repayments'
  ];
  for (const table of payrollFkTables) {
    const fk = db.prepare(`PRAGMA foreign_key_list(${table})`).all().find(row => row.table === 'payroll_employees');
    if (!fk || String(fk.on_delete).toUpperCase() !== 'RESTRICT') {
      throw new Error(`Database integrity failure: ${table}.payroll_employees FK is not ON DELETE RESTRICT.`);
    }
  }

  return {
    ok: true,
    foreignKeys: true,
    integrityCheck: true,
    foreignKeyViolations: 0,
    tenantChecks: true,
    requiredTables: REQUIRED_TABLES.length,
    requiredIndexes: REQUIRED_INDEXES.length,
    appendOnlyAuditTriggers: APPEND_ONLY_TRIGGERS.length
  };
}

module.exports = { verifyDatabaseIntegrity };
