const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const config = require('../config');
const { info, error: logError, safeError } = require('../security/logger');

fs.mkdirSync(config.dataDir, { recursive: true });

const pendingRecoveryMarker = `${config.dbPath}.pending-recovery.json`;

function validateRecoveryDatabase(file) {
  const candidate = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = candidate.prepare('PRAGMA integrity_check').get();
    if (!integrity || String(Object.values(integrity)[0]) !== 'ok') return false;
    const tables = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
    const required = ['companies','users','businesses','sessions','audit_logs','sales_transactions'];
    if (required.some(table => !tables.has(table))) return false;
    const triggers = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(x=>x.name));
    return ['trg_audit_logs_no_update','trg_audit_logs_no_delete'].every(trigger => triggers.has(trigger));
  } finally { candidate.close(); }
}

function recoverInterruptedDatabaseImport() {
  if (!fs.existsSync(pendingRecoveryMarker)) return;
  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(pendingRecoveryMarker, 'utf8')); } catch (error) {
    throw new Error(`Database recovery marker is unreadable: ${error.message}`);
  }
  const previousPath = String(marker?.previousPath || '');
  if (!previousPath || !fs.existsSync(previousPath)) {
    throw new Error('Database recovery marker exists but its previous database backup is missing. Startup was stopped to avoid data loss.');
  }

  // The marker means the new database has not yet completed the entire startup
  // recovery marker retained until startup validation completes.
  // migration + Stage 10D verification path. Never trust it merely because its
  // SQLite file happens to pass a basic integrity check: restore the last known
  // good database and retain the interrupted candidate for investigation.
  const failedPath = `${config.dbPath}.failed-${Date.now()}`;
  try {
    if (fs.existsSync(config.dbPath)) fs.renameSync(config.dbPath, failedPath);
    fs.renameSync(previousPath, config.dbPath);
    if (!validateRecoveryDatabase(config.dbPath)) throw new Error('Previous database failed recovery validation.');
    fs.rmSync(pendingRecoveryMarker, { force: true });
    // Failed database retained for investigation: the interrupted candidate is never silently discarded.
    logError('database.recovered_previous', { failedPath });
  } catch (error) {
    try {
      if (!fs.existsSync(config.dbPath) && fs.existsSync(previousPath)) fs.renameSync(previousPath, config.dbPath);
    } catch {}
    throw new Error(`Database recovery failed: ${error.message}`);
  }
}
function finalizeDatabaseImportRecovery() {
  if (!fs.existsSync(pendingRecoveryMarker)) return;
  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(pendingRecoveryMarker, 'utf8')); } catch (error) {
    throw new Error(`Database recovery marker is unreadable: ${error.message}`);
  }
  if (marker?.previousPath && fs.existsSync(marker.previousPath)) fs.rmSync(marker.previousPath, { force: true });
  fs.rmSync(pendingRecoveryMarker, { force: true });
  info('database.recovery_marker_finalized');
}

function applyPendingDatabaseImport() {
  recoverInterruptedDatabaseImport();
  const pendingPath = `${config.dbPath}.pending`;
  if (!fs.existsSync(pendingPath)) return;
  const previousPath = `${config.dbPath}.pre-import-${Date.now()}`;
  try {
    // Validate the staged database before touching the live database. This runs before
    // the main connection is opened, so a corrupt/incompatible restore cannot replace it.
    const candidate = new Database(pendingPath, { readonly: true, fileMustExist: true });
    try {
      const integrity = candidate.prepare('PRAGMA integrity_check').get();
      if (!integrity || String(Object.values(integrity)[0]) !== 'ok') throw new Error('Staged database failed integrity_check.');
      const tables = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
      for (const table of ['companies','users','businesses','sessions','audit_logs','sales_transactions']) {
        if(!tables.has(table)) throw new Error(`Staged database is missing required table: ${table}`);
      }
      const triggers = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(x=>x.name));
      for (const trigger of ['trg_audit_logs_no_update','trg_audit_logs_no_delete']) {
        if(!triggers.has(trigger)) throw new Error(`Staged database is missing required audit protection trigger: ${trigger}`);
      }
    } finally { candidate.close(); }
    for (const sidecar of [`${config.dbPath}-wal`, `${config.dbPath}-shm`]) {
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    }
    if (fs.existsSync(config.dbPath)) fs.renameSync(config.dbPath, previousPath);
    fs.writeFileSync(pendingRecoveryMarker, JSON.stringify({format:1,previousPath,pendingPath,createdAt:new Date().toISOString()}), 'utf8');
    fs.renameSync(pendingPath, config.dbPath);
    for (const sidecar of [`${config.dbPath}-wal`, `${config.dbPath}-shm`]) {
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    }
    // Keep the previous live database and recovery marker until the new database
    // survives the complete startup migration + Stage 10D integrity verification.
    info('database.pending_import_applied');
  } catch (error) {
    logError('database.pending_import_failed', { error: safeError(error) });
    if (!fs.existsSync(config.dbPath) && fs.existsSync(previousPath)) {
      try { fs.renameSync(previousPath, config.dbPath); } catch {}
    }
    throw error;
  }
}
applyPendingDatabaseImport();

function migrateLegacyLocalDatabase() {
  const legacyPath = path.join(process.cwd(), 'data', 'reportgen.sqlite');
  if (path.resolve(legacyPath) === path.resolve(config.dbPath)) return;
  if (!fs.existsSync(legacyPath) || fs.existsSync(config.dbPath)) return;
  fs.copyFileSync(legacyPath, config.dbPath);
  info('database.legacy_imported');
}

migrateLegacyLocalDatabase();

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
// Keep a modest SQLite page cache for repeated date-range/report queries.
// Negative values specify kibibytes, so this reserves up to 32 MiB per DB connection.
db.pragma('cache_size = -32768');

// --- Pre-migration safety backup -------------------------------------------------
// Startup migrations below may need to rebuild tables in-place (SQLite cannot ALTER
// a foreign-key definition, so changing ON DELETE behavior requires a full
// create-new/copy-data/drop-old/rename table rebuild). Before running any such
// rebuild against an existing database, take a verified, checksummed backup.
//
// This cannot reuse server/database/backupService.js: that module does
// `require('./database')` to get `db`, and this file (database.js) is still
// executing its own top-level code at this point (module.exports has not run
// yet), so requiring backupService here would hit a circular require and get
// back an incomplete module whose `db` is undefined. Instead this performs a
// minimal, self-contained backup using the same `db` handle already open above.
function createPreMigrationBackup(label) {
  try {
    // Flush the WAL into the main database file so the file we copy is complete
    // and self-contained, not split across reportgen.sqlite / -wal / -shm.
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    logError('database.wal_checkpoint_failed', { error: safeError(error) });
  }
  const backupDir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const filename = `reportgen-premigration-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  const target = path.join(backupDir, filename);
  fs.copyFileSync(config.dbPath, target);

  // Verify the backup is a valid, uncorrupted SQLite database before trusting it.
  const check = new Database(target, { readonly: true, fileMustExist: true });
  try {
    const row = check.prepare('PRAGMA integrity_check').get();
    if (!row || String(Object.values(row)[0]) !== 'ok') {
      throw new Error('pre-migration backup failed integrity_check');
    }
  } finally {
    check.close();
    // Opening the (WAL-mode) backup file, even readonly, makes SQLite create -wal
    // and -shm sidecars next to it. They are harmless (source was checkpointed to
    // TRUNCATE before copying, so the backup's own WAL is empty) but serve no
    // purpose once this validation connection is closed, so remove them to keep
    // the backup directory to a single self-contained .sqlite file per backup.
    for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
      try { fs.rmSync(sidecar, { force: true }); } catch {}
    }
  }
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  fs.writeFileSync(`${target}.sha256`, `${checksum}  ${filename}\n`, 'utf8');
  info('database.pre_migration_backup_verified');
  return target;
}

// --- Existing-database payroll foreign-key migration (RESTRICT) ------------------
// schema.sql defines these tables' staff_id/employee_id foreign key as
// "REFERENCES payroll_employees(id) ON DELETE RESTRICT" so a staff record can never
// be physically removed while payroll/loan/deduction history for that staff member
// still exists. But schema.sql uses CREATE TABLE IF NOT EXISTS, so on a database
// created before this fix, the table already exists and that statement is a no-op:
// the original ON DELETE CASCADE definition silently remains in place. This checks
// each affected table's live foreign-key definition (not just the schema.sql text)
// and rebuilds only the tables that actually still need it.
const PAYROLL_EMPLOYEE_FK_TABLES = [
  'payroll_entries',
  'payroll_staff_loans',
  'payroll_staff_deductions',
  'payroll_loan_skips',
  'payroll_manual_staff_adjustments',
  'payroll_loan_repayments'
];

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

// Returns the subset of PAYROLL_EMPLOYEE_FK_TABLES whose live payroll_employees
// foreign key is not already ON DELETE RESTRICT (checked via PRAGMA against the
// actual table definition, not schema.sql text, since schema.sql's CREATE TABLE IF
// NOT EXISTS can silently no-op on a database that already has the table).
function findTablesNeedingRestrictMigration() {
  return PAYROLL_EMPLOYEE_FK_TABLES.filter(table => {
    if (!tableExists(table)) return false;
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    const fk = fks.find(f => f.table === 'payroll_employees');
    return fk && String(fk.on_delete).toUpperCase() !== 'RESTRICT';
  });
}

// Builds a CREATE TABLE statement for a rebuild by reading the table's *current live*
// definition out of sqlite_master (which reflects any columns added over time by the
// ALTER TABLE migrations elsewhere in this file, not just the original schema.sql
// shape) and tightening only the payroll_employees foreign key's ON DELETE action.
// Every other column, default, CHECK constraint, and foreign key is left untouched,
// satisfying "preserve every existing row and ID... preserve indexes, constraints,
// and columns."
function buildRestrictedCreateSql(table, tmpName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!row || !row.sql) throw new Error(`Cannot read live schema for table ${table} to migrate its foreign key.`);
  let sql = row.sql.replace(new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${table}\\b`, 'i'), `CREATE TABLE ${tmpName}`);
  const fkPattern = /REFERENCES\s+payroll_employees\s*\(\s*\w+\s*\)\s+ON\s+DELETE\s+\w+/i;
  if (!fkPattern.test(sql)) {
    throw new Error(`Could not locate the payroll_employees foreign key in ${table}'s live schema to migrate it.`);
  }
  sql = sql.replace(fkPattern, match => match.replace(/ON\s+DELETE\s+\w+/i, 'ON DELETE RESTRICT'));
  return sql;
}

function migratePayrollForeignKeysToRestrict(tables) {
  if (!tables.length) return;
  const names = tables.join(', ');
  console.log(`[DATABASE] Existing ON DELETE CASCADE found on payroll_employees reference in: ${names}. Rebuilding with ON DELETE RESTRICT to protect payroll/loan/deduction history.`);

  const backupPath = createPreMigrationBackup('payroll-fk-restrict');

  // Pre-migration integrity check on the live database, before touching anything.
  const preCheck = db.prepare('PRAGMA integrity_check').get();
  if (!preCheck || String(Object.values(preCheck)[0]) !== 'ok') {
    throw new Error(`Refusing to run payroll foreign-key migration: database failed integrity_check before migration. A verified backup was saved to ${backupPath} for investigation.`);
  }

  // Snapshot row counts so we can verify nothing was lost after the rebuild.
  const beforeCounts = {};
  for (const table of tables) beforeCounts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  db.pragma('foreign_keys = OFF');
  const runMigration = db.transaction(() => {
    for (const table of tables) {
      const tmpName = `${table}__fk_restrict_rebuild`;
      const createSql = buildRestrictedCreateSql(table, tmpName);
      // Capture this table's own indexes before dropping it - DROP TABLE removes them.
      const indexSqls = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table).map(r => r.sql);
      db.exec(createSql);
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name).join(',');
      db.exec(`INSERT INTO ${tmpName} (${cols}) SELECT ${cols} FROM ${table}`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${tmpName} RENAME TO ${table}`);
      for (const stmt of indexSqls) db.exec(stmt);
    }
  });

  try {
    runMigration();
  } catch (error) {
    db.pragma('foreign_keys = ON');
    throw new Error(`Payroll foreign-key migration failed and was rolled back: ${error.message}. A verified pre-migration backup is available at ${backupPath}.`);
  }
  db.pragma('foreign_keys = ON');

  // Row-count preservation check.
  for (const table of tables) {
    const afterCount = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    if (afterCount !== beforeCounts[table]) {
      throw new Error(`Payroll foreign-key migration row-count mismatch on ${table}: had ${beforeCounts[table]}, now ${afterCount}. Restore from backup at ${backupPath} and investigate before proceeding.`);
    }
  }

  // Foreign-key and integrity verification, as required for any live migration.
  const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
  if (fkErrors.length) {
    throw new Error(`Payroll foreign-key migration left ${fkErrors.length} foreign-key violation(s). Restore from backup at ${backupPath} and investigate: ${JSON.stringify(fkErrors.slice(0, 5))}`);
  }
  const postCheck = db.prepare('PRAGMA integrity_check').get();
  if (!postCheck || String(Object.values(postCheck)[0]) !== 'ok') {
    throw new Error(`Payroll foreign-key migration left the database failing integrity_check. Restore from backup at ${backupPath} and investigate.`);
  }

  const stillNeeding = findTablesNeedingRestrictMigration();
  if (stillNeeding.length) {
    throw new Error(`Payroll foreign-key migration did not take effect on: ${stillNeeding.join(', ')}. Restore from backup at ${backupPath} and investigate.`);
  }

  console.log(`[DATABASE] Payroll foreign-key migration to ON DELETE RESTRICT completed and verified for: ${names}. Row counts preserved, foreign_key_check and integrity_check passed.`);
}

function migrate() {
  info('database.opened');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  // Request-level idempotency records protect retryable financial mutations from
  // double-clicks and network retries without imposing business-level uniqueness
  // on legitimate repeated transactions. Records are scoped to company, user and
  // route; a reused key with different request data is rejected.
  db.exec(`CREATE TABLE IF NOT EXISTS idempotency_keys (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    route TEXT NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('processing','completed')),
    response_status INTEGER,
    response_body TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(company_id,user_id,route,key)
  );
  CREATE INDEX IF NOT EXISTS idx_idempotency_updated ON idempotency_keys(updated_at);`);

  // Audit integrity: application users may append audit records through auditService,
  // but live audit entries cannot be updated or deleted through SQLite, including by
  // accidental maintenance code. Database restore/reset remains a separate administrative
  // operation and is itself audited where the application performs it.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_company_action ON audit_logs(company_id, action, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_company_user_time ON audit_logs(company_id, user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_company_business_time ON audit_logs(company_id, business_id, created_at);
    CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs are append-only'); END;
  `);

  // Must run before any of the later ALTER TABLE column additions below: it rebuilds
  // whatever columns currently exist, and anything schema.sql intends to add after
  // this point will simply be layered on afterward by the guarded ALTER statements.
  migratePayrollForeignKeysToRestrict(findTablesNeedingRestrictMigration());

  const columns = db.prepare('PRAGMA table_info(companies)').all().map(x => x.name);
  for (const [name, type] of [['address','TEXT'],['phone','TEXT'],['email','TEXT'],['logo_data_url','TEXT'],['staff_id_prefix',"TEXT DEFAULT 'STF'"]]) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type}`);
  }
  // Vendor payment tracker is intentionally lightweight: date, amount, optional business and note.
  db.exec(`CREATE TABLE IF NOT EXISTS vendor_payments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    note TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vendor_payments_company_date ON vendor_payments(company_id,payment_date);
  CREATE INDEX IF NOT EXISTS idx_vendor_payments_business_date ON vendor_payments(business_id,payment_date);`);
  const ownerAdjustmentCols = db.prepare("PRAGMA table_info(dashboard_owner_adjustments)").all().map(x => x.name);
  if (!ownerAdjustmentCols.includes('excluded')) db.exec("ALTER TABLE dashboard_owner_adjustments ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0");
  db.exec(`CREATE TABLE IF NOT EXISTS dashboard_owner_defaults (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    percent REAL NOT NULL DEFAULT 0 CHECK(percent >= 0 AND percent <= 100),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(company_id,month)
  );
  CREATE INDEX IF NOT EXISTS idx_dashboard_owner_default_company_month ON dashboard_owner_defaults(company_id,month);`);
  const capitalCols = db.prepare("PRAGMA table_info(capital_contributions)").all().map(x => x.name);
  if (!capitalCols.includes('entry_mode')) db.exec("ALTER TABLE capital_contributions ADD COLUMN entry_mode TEXT NOT NULL DEFAULT 'individual'");
  // Loan repayment ledger is created by schema.sql for new databases and by this
  // guarded migration for existing installations. In practice schema.sql (above)
  // already creates this table with the correct ON DELETE RESTRICT staff_id
  // reference before this line runs, so this CREATE TABLE IF NOT EXISTS is normally
  // a no-op - but its own definition is kept consistent with RESTRICT rather than
  // CASCADE so it is never wrong in the case where it does fire.
  db.exec(`CREATE TABLE IF NOT EXISTS payroll_loan_repayments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    loan_id TEXT NOT NULL REFERENCES payroll_staff_loans(id) ON DELETE CASCADE,
    staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    payroll_month TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount >= 0),
    status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','voided')),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    UNIQUE(loan_id,payroll_month)
  );
  CREATE INDEX IF NOT EXISTS idx_loan_repayments_staff ON payroll_loan_repayments(staff_id,payroll_month);
  CREATE INDEX IF NOT EXISTS idx_loan_repayments_business ON payroll_loan_repayments(business_id,payroll_month);`);
  db.exec(`CREATE TABLE IF NOT EXISTS payroll_loan_skips (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    loan_id TEXT NOT NULL REFERENCES payroll_staff_loans(id) ON DELETE CASCADE,
    staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    skip_month TEXT NOT NULL,
    reason TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    UNIQUE(loan_id,skip_month)
  );
  CREATE INDEX IF NOT EXISTS idx_loan_skips_loan_month ON payroll_loan_skips(loan_id,skip_month);
  CREATE INDEX IF NOT EXISTS idx_loan_skips_staff_month ON payroll_loan_skips(staff_id,skip_month);
  CREATE TABLE IF NOT EXISTS payroll_manual_staff_adjustments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
    payroll_month TEXT NOT NULL,
    deduction_applied INTEGER NOT NULL DEFAULT 0 CHECK(deduction_applied IN (0,1)),
    loan_applied INTEGER NOT NULL DEFAULT 0 CHECK(loan_applied IN (0,1)),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(company_id,business_id,staff_id,payroll_month)
  );
  CREATE INDEX IF NOT EXISTS idx_manual_staff_adjustments_period ON payroll_manual_staff_adjustments(company_id,business_id,payroll_month);`);

  const manualAdjCols = db.prepare("PRAGMA table_info(payroll_manual_staff_adjustments)").all().map(x => x.name);
  for (const [name, type, defaultValue] of [['gross_amount','REAL','0'],['deduction_amount','REAL','0'],['loan_repayment_amount','REAL','0'],['net_amount','REAL','0']]) {
    if (!manualAdjCols.includes(name)) db.exec(`ALTER TABLE payroll_manual_staff_adjustments ADD COLUMN ${name} ${type} NOT NULL DEFAULT ${defaultValue}`);
  }
  const payrollEntryCols = db.prepare("PRAGMA table_info(payroll_entries)").all().map(x => x.name);
  for (const [name, type, defaultValue] of [['deduction_amount','REAL','0'],['loan_repayment_amount','REAL','0']]) {
    if (!payrollEntryCols.includes(name)) db.exec(`ALTER TABLE payroll_entries ADD COLUMN ${name} ${type} NOT NULL DEFAULT ${defaultValue}`);
  }
  const payrollTotalCols = db.prepare("PRAGMA table_info(payroll_monthly_totals)").all().map(x => x.name);
  if (!payrollTotalCols.includes('calculation_mode')) db.exec("ALTER TABLE payroll_monthly_totals ADD COLUMN calculation_mode TEXT NOT NULL DEFAULT 'manual'");
  if (!payrollTotalCols.includes('status')) db.exec("ALTER TABLE payroll_monthly_totals ADD COLUMN status TEXT NOT NULL DEFAULT 'saved'");
  if (!payrollTotalCols.includes('payment_status')) db.exec("ALTER TABLE payroll_monthly_totals ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'");
  if (!payrollTotalCols.includes('paid_at')) db.exec("ALTER TABLE payroll_monthly_totals ADD COLUMN paid_at TEXT");
  // Payment ledger: payments are voided (with a reason), never deleted. Older installs created this
  // table without the status/void columns, so add them here.
  const payrollPaymentCols = db.prepare("PRAGMA table_info(payroll_payments)").all().map(x => x.name);
  for (const [name, definition] of [['status', "TEXT NOT NULL DEFAULT 'posted'"], ['voided_at', 'TEXT'], ['voided_by', 'TEXT'], ['void_reason', 'TEXT']]) {
    if (!payrollPaymentCols.includes(name)) db.exec(`ALTER TABLE payroll_payments ADD COLUMN ${name} ${definition}`);
  }
  // Database-level backstop: payroll_payments.payroll_id is ON DELETE CASCADE, so without this a
  // delete of a payroll total would silently erase its payment history. The route also checks first.
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_payroll_totals_keep_payment_history BEFORE DELETE ON payroll_monthly_totals
    WHEN EXISTS (SELECT 1 FROM payroll_payments WHERE payroll_id = OLD.id)
    BEGIN SELECT RAISE(ABORT, 'payroll with payment records cannot be deleted'); END;`);
  const messageCols = db.prepare("PRAGMA table_info(internal_messages)").all().map(x => x.name);
  for (const [name, type] of [['deleted_by_sender_at','TEXT'],['deleted_by_recipient_at','TEXT']]) {
    if (!messageCols.includes(name)) db.exec(`ALTER TABLE internal_messages ADD COLUMN ${name} ${type}`);
  }
  const payrollCols = db.prepare("PRAGMA table_info(payroll_employees)").all().map(x => x.name);
  for (const [name, type, defaultValue] of [['department','TEXT',null],['base_salary','REAL','0'],['status','TEXT',"'active'"],['status_reason','TEXT',null],['archive_date','TEXT',null],['return_date','TEXT',null],['user_id','TEXT',null]]) {
    if (!payrollCols.includes(name)) db.exec(`ALTER TABLE payroll_employees ADD COLUMN ${name} ${type}${defaultValue !== null ? ` DEFAULT ${defaultValue}` : ''}`);
  }
  // Seed master departments and job roles from existing staff values so the new selectors do not discard existing data.
  const existingStaff = db.prepare('SELECT company_id, role_title, department, created_by, created_at FROM payroll_employees WHERE company_id IS NOT NULL').all();
  const insertDept = db.prepare('INSERT OR IGNORE INTO organization_departments(id,company_id,name,is_active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
  const insertRole = db.prepare('INSERT OR IGNORE INTO organization_job_roles(id,company_id,name,department_id,is_active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  const makeId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  for (const row of existingStaff) {
    const stamp = row.created_at || new Date().toISOString();
    let departmentId = null;
    if (String(row.department || '').trim()) {
      const name = String(row.department).trim();
      insertDept.run(makeId('dept'), row.company_id, name, 1, row.created_by || null, stamp, stamp);
      departmentId = db.prepare('SELECT id FROM organization_departments WHERE company_id=? AND lower(name)=lower(?)').get(row.company_id,name)?.id || null;
    }
    if (String(row.role_title || '').trim()) {
      const name = String(row.role_title).trim();
      insertRole.run(makeId('job'), row.company_id, name, departmentId, 1, row.created_by || null, stamp, stamp);
    }
  }

  // Backfill generated staff IDs for existing records that do not have one.
  const companies = db.prepare("SELECT id, COALESCE(NULLIF(staff_id_prefix,''),'STF') AS staff_id_prefix FROM companies").all();
  for (const company of companies) {
    const prefix = String(company.staff_id_prefix || 'STF').toUpperCase();
    const rows = db.prepare("SELECT id, employee_code FROM payroll_employees WHERE company_id=? ORDER BY created_at, id").all(company.id);
    let next = rows.reduce((max, row) => { const match = String(row.employee_code || '').match(new RegExp(`^${prefix}-(\\d+)$`)); return match ? Math.max(max, Number(match[1])) : max; }, 0);
    const update = db.prepare('UPDATE payroll_employees SET employee_code=?, updated_at=? WHERE id=? AND company_id=?');
    for (const row of rows) {
      if (row.employee_code) continue;
      next += 1;
      update.run(`${prefix}-${String(next).padStart(4,'0')}`, new Date().toISOString(), row.id, company.id);
    }
  }

  // Staff ID integrity backstop: earlier versions accepted a raw employee_code on
  // PATCH and on inline staff creation with no uniqueness check, so an existing
  // database may already contain duplicate codes within a company. Rename any
  // duplicates (keeping the earliest record's code untouched) before adding the
  // UNIQUE index below, so the index creation itself can never fail on upgrade.
  const dupGroups = db.prepare(`
    SELECT company_id, upper(employee_code) AS code, COUNT(*) AS n
    FROM payroll_employees
    WHERE employee_code IS NOT NULL AND TRIM(employee_code) != ''
    GROUP BY company_id, upper(employee_code)
    HAVING COUNT(*) > 1
  `).all();
  if (dupGroups.length) {
    const renameStmt = db.prepare('UPDATE payroll_employees SET employee_code=?, updated_at=? WHERE id=?');
    for (const group of dupGroups) {
      const rows = db.prepare('SELECT id, created_at FROM payroll_employees WHERE company_id=? AND upper(employee_code)=? ORDER BY created_at, id')
        .all(group.company_id, group.code);
      // Keep the first (oldest) record's code as-is; rename the rest so they stay unique.
      rows.slice(1).forEach((row, i) => {
        renameStmt.run(`${group.code}-DUP${i + 2}`, new Date().toISOString(), row.id);
      });
    }
    console.log(`[DATABASE] Renamed duplicate Staff IDs in ${dupGroups.length} group(s) to restore uniqueness.`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_employees_code ON payroll_employees(company_id, employee_code) WHERE employee_code IS NOT NULL;');

  const userTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (userTable && !String(userTable.sql || '').includes('general_manager')) {
    const userMigrationBackup = createPreMigrationBackup('users-role-rebuild');
    const beforeUserCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    db.pragma('foreign_keys = OFF');
    // Critical: by default (legacy_alter_table = OFF, SQLite's modern default), an
    // ALTER TABLE RENAME automatically rewrites every OTHER table's stored foreign
    // key text that pointed at the old name - regardless of the foreign_keys pragma
    // above, which only controls constraint enforcement, not this rename behavior.
    // Without this, every table with e.g. "created_by ... REFERENCES users(id)"
    // would silently end up pointing at "users_legacy_roles" and then be left
    // dangling once that table is dropped below, corrupting referential integrity
    // across the whole database. Turning this on makes RENAME touch only the users
    // table itself, so every other table's unchanged "REFERENCES users(id)" text
    // continues to correctly resolve to the freshly created "users" table.
    db.pragma('legacy_alter_table = ON');
    db.exec(`
      BEGIN;
      ALTER TABLE users RENAME TO users_legacy_roles;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('administrator','admin','owner','general_manager','accountant','business_manager','viewer')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, username)
      );
      INSERT INTO users (id, company_id, username, display_name, password_hash, role, is_active, created_at, updated_at)
      SELECT id, company_id, username, display_name, password_hash,
        CASE WHEN role='admin' THEN 'administrator' ELSE role END,
        is_active, created_at, updated_at
      FROM users_legacy_roles;
      DROP TABLE users_legacy_roles;
      COMMIT;
    `);
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id)');

    const afterUserCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (afterUserCount !== beforeUserCount) {
      throw new Error(`User-role migration row-count mismatch: had ${beforeUserCount}, now ${afterUserCount}. Restore from backup at ${userMigrationBackup} and investigate before proceeding.`);
    }
    // Whole-database check, not just the users table: this migration's historical
    // bug (see the legacy_alter_table comment above) corrupted OTHER tables'
    // foreign key definitions, not Users' own, so scoping this to users() alone
    // would have missed it.
    const userFkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (userFkErrors.length) {
      throw new Error(`User-role migration left ${userFkErrors.length} foreign-key violation(s) across the database. Restore from backup at ${userMigrationBackup} and investigate: ${JSON.stringify(userFkErrors.slice(0, 5))}`);
    }
    const userIntegrity = db.prepare('PRAGMA integrity_check').get();
    if (!userIntegrity || String(Object.values(userIntegrity)[0]) !== 'ok') {
      throw new Error(`User-role migration left the database failing integrity_check. Restore from backup at ${userMigrationBackup} and investigate.`);
    }
    console.log(`[DATABASE] User-role migration completed and verified. Row count preserved (${afterUserCount}), foreign_key_check and integrity_check passed.`);
  }
}

function health() {
  const row = db.prepare('SELECT 1 AS ok').get();
  return { ok: row.ok === 1, journalMode: db.pragma('journal_mode', { simple: true }) };
}

// The 'payroll.salaries' permission is new. Roles that already have saved permission rows would otherwise fall back to
// the built-in default for it (which is ON for General Manager). Seed it from each role's existing payroll.view value so
// nothing is silently widened: a role without payroll.view no longer sees salaries anywhere. Idempotent (UNIQUE + OR IGNORE).
function migrateSalaryPermission() {
  db.prepare(`INSERT OR IGNORE INTO role_permissions (id, company_id, role, permission, enabled, updated_by, updated_at)
    SELECT 'rperm_' || lower(hex(randomblob(8))), company_id, role, 'payroll.salaries', enabled, NULL, ?
    FROM role_permissions WHERE permission = 'payroll.view'`).run(new Date().toISOString());
}

migrate();
migrateSalaryPermission();
// Stage 10D: fail closed if SQLite or tenant-scoped relational integrity is broken.
const { verifyDatabaseIntegrity } = require('./integrity');
const integrityResult = verifyDatabaseIntegrity(db);
console.log(`[DATABASE] Stage 10D integrity verification passed: ${JSON.stringify(integrityResult)}`);
// Stage 10E: only retire the previous database after the full startup path has
// completed successfully. If startup crashes before this point, the next launch
// can use the recovery marker to restore the previous verified database.
finalizeDatabaseImportRecovery();
// Refresh planner statistics after migrations and index creation. SQLite bounds this work.
db.pragma('optimize = 0x10002');
const queryPlannerMaintenance = setInterval(() => {
  try { db.pragma('optimize'); } catch (error) { logError('database.optimize_failed', { error: safeError(error) }); }
}, 24 * 60 * 60 * 1000);
queryPlannerMaintenance.unref?.();

module.exports = { db, health, migrateSalaryPermission };
