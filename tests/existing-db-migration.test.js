const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// Isolate this test run from the real persistent database: this MUST be set
// before server/config (and therefore server/database/database) is required
// anywhere in this process, or tests will read/write the live app database.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-test-'));
process.env.REPORTGEN_DATA_DIR = dataDir;

const Database = require('better-sqlite3');

// Build a synthetic "legacy" database on disk BEFORE requiring server/database,
// so that requiring it triggers the real startup migration path against a
// database that predates:
//   1. the payroll_employees foreign key CASCADE -> RESTRICT fix, and
//   2. the general_manager user role.
// This is the exact scenario section 3.2 (existing-database migration safety)
// is about: an upgrade running against a database created by an older version.
function buildLegacyDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE businesses (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','owner','accountant','business_manager','viewer')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id, username)
    );
    CREATE TABLE payroll_employees (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      employee_code TEXT,
      employee_name TEXT NOT NULL,
      role_title TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id,business_id,employee_name)
    );
    CREATE TABLE payroll_entries (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
      payroll_month TEXT NOT NULL,
      gross_amount REAL NOT NULL CHECK(gross_amount >= 0),
      deductions REAL NOT NULL DEFAULT 0 CHECK(deductions >= 0),
      net_amount REAL NOT NULL CHECK(net_amount >= 0),
      note TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(employee_id,payroll_month)
    );
    CREATE INDEX idx_payroll_entries_business_period ON payroll_entries(business_id,payroll_month);
    CREATE TABLE payroll_staff_loans (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
      principal_amount REAL NOT NULL CHECK(principal_amount >= 0),
      monthly_amount REAL NOT NULL CHECK(monthly_amount >= 0),
      start_month TEXT NOT NULL, end_month TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
      note TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_staff_loans_staff ON payroll_staff_loans(staff_id,status);
    CREATE TABLE payroll_staff_deductions (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      staff_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK(amount >= 0), category TEXT NOT NULL, start_month TEXT NOT NULL, end_month TEXT,
      note TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_staff_deductions_staff ON payroll_staff_deductions(staff_id,start_month,end_month);
  `);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO companies VALUES (?,?,?)').run('co1', 'Acme Co', now);
  db.prepare('INSERT INTO businesses VALUES (?,?,?,?)').run('biz1', 'co1', 'Main Store', now);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run('u1', 'co1', 'admin', 'Admin User', 'hash', 'admin', 1, now, now);
  db.prepare('INSERT INTO payroll_employees VALUES (?,?,?,?,?,?,?,?,?,?)').run('emp1', 'co1', 'biz1', 'STF-0001', 'Jane Doe', 'Cashier', 1, 'u1', now, now);
  db.prepare('INSERT INTO payroll_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('pe1', 'co1', 'biz1', 'emp1', '2026-08', 1000, 50, 950, null, 'u1', now, now);
  db.prepare('INSERT INTO payroll_staff_loans (id,company_id,staff_id,principal_amount,monthly_amount,start_month,end_month,status,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('loan1', 'co1', 'emp1', 500, 50, '2026-08', null, 'active', null, 'u1', now, now);
  db.prepare('INSERT INTO payroll_staff_deductions (id,company_id,staff_id,amount,category,start_month,end_month,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('ded1', 'co1', 'emp1', 25, 'uniform', '2026-08', null, null, 'u1', now, now);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

const dbPath = path.join(dataDir, 'reportgen.sqlite');
buildLegacyDatabase(dbPath);

// Requiring this triggers the real startup migrate() path in server/database/database.js.
const { db } = require('../server/database/database');

test('existing-database migration backs up before touching a legacy database', () => {
  const backupDir = path.join(dataDir, 'backups');
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sqlite'));
  assert.ok(files.some(f => f.includes('payroll-fk-restrict')), 'expected a pre-migration payroll FK backup');
  assert.ok(files.some(f => f.includes('users-role-rebuild')), 'expected a pre-migration users-role backup');
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(backupDir, `${f}.sha256`)), `missing checksum for backup ${f}`);
    // No leftover -wal/-shm sidecars should remain next to a finished backup.
    assert.equal(fs.existsSync(path.join(backupDir, `${f}-wal`)), false);
    assert.equal(fs.existsSync(path.join(backupDir, `${f}-shm`)), false);
  }
});

test('existing-database migration upgrades payroll foreign keys to RESTRICT', () => {
  for (const table of ['payroll_entries', 'payroll_staff_loans', 'payroll_staff_deductions']) {
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    const fk = fks.find(f => f.table === 'payroll_employees');
    assert.equal(fk.on_delete, 'RESTRICT', `${table} should now be ON DELETE RESTRICT`);
  }
});

test('existing-database migration preserves every row, ID, and value', () => {
  const employee = db.prepare('SELECT * FROM payroll_employees WHERE id=?').get('emp1');
  assert.ok(employee, 'staff row with its original ID should survive migration');
  assert.equal(employee.employee_name, 'Jane Doe');

  const entry = db.prepare('SELECT * FROM payroll_entries WHERE id=?').get('pe1');
  assert.ok(entry);
  assert.equal(entry.gross_amount, 1000);
  assert.equal(entry.net_amount, 950);

  const loan = db.prepare('SELECT * FROM payroll_staff_loans WHERE id=?').get('loan1');
  assert.ok(loan);
  assert.equal(loan.principal_amount, 500);

  const deduction = db.prepare('SELECT * FROM payroll_staff_deductions WHERE id=?').get('ded1');
  assert.ok(deduction);
  assert.equal(deduction.category, 'uniform');
});

test('existing-database migration upgrades the users table role set without corrupting other tables\' foreign keys', () => {
  const userTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
  assert.match(userTableSql, /general_manager/);

  const user = db.prepare('SELECT * FROM users WHERE id=?').get('u1');
  assert.equal(user.role, 'administrator'); // 'admin' was normalized to 'administrator'

  // Regression check for the cross-table FK corruption bug this migration used to
  // have: renaming users -> users_legacy_roles (without legacy_alter_table=ON)
  // silently rewrote every OTHER table's stored "REFERENCES users(id)" text to
  // point at users_legacy_roles, which was then dropped, leaving dangling FKs.
  for (const table of ['payroll_entries', 'payroll_employees', 'payroll_staff_loans', 'payroll_staff_deductions']) {
    const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table).sql;
    assert.doesNotMatch(sql, /users_legacy_roles/, `${table} must not reference the dropped users_legacy_roles table`);
  }

  const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
  assert.deepEqual(fkErrors, []);

  const integrity = db.prepare('PRAGMA integrity_check').get();
  assert.equal(Object.values(integrity)[0], 'ok');
});

test('RESTRICT is actually enforced: staff with payroll history cannot be physically deleted', () => {
  assert.throws(() => {
    db.prepare('DELETE FROM payroll_employees WHERE id=?').run('emp1');
  }, /FOREIGN KEY constraint failed/);
});

test('RESTRICT does not block deleting staff with no payroll/loan/deduction history', () => {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO payroll_employees
    (id,company_id,business_id,employee_code,employee_name,role_title,is_active,created_by,created_at,updated_at,department,base_salary,status,status_reason,archive_date,return_date,user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('emp-no-history', 'co1', 'biz1', 'STF-0099', 'No History', 'Clerk', 1, 'u1', now, now, null, 0, 'active', null, null, null, null);
  assert.doesNotThrow(() => {
    db.prepare('DELETE FROM payroll_employees WHERE id=?').run('emp-no-history');
  });
});

test('re-requiring the database module against an already-migrated database is a no-op', () => {
  delete require.cache[require.resolve('../server/database/database')];
  const backupDirBefore = fs.readdirSync(path.join(dataDir, 'backups')).length;
  const { health } = require('../server/database/database');
  assert.equal(health().ok, true);
  const backupDirAfter = fs.readdirSync(path.join(dataDir, 'backups')).length;
  assert.equal(backupDirAfter, backupDirBefore, 'a second boot of an already-migrated database should not create new pre-migration backups');
});
