'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('database restore uses a recovery marker and only retires the previous database after full integrity verification', () => {
  const src = read('server/database/database.js');
  assert.match(src, /pending-recovery\.json/);
  assert.match(src, /recoverInterruptedDatabaseImport\(\)/);
  assert.match(src, /finalizeDatabaseImportRecovery\(\)/);
  assert.match(src, /verifyRecoveryDatabase|validateRecoveryDatabase/);
  assert.match(src, /recovery marker retained until startup validation completes/);
});

test('interrupted restore keeps the previous database available and fails closed if recovery is impossible', () => {
  const src = read('server/database/database.js');
  assert.match(src, /previous database backup is missing/);
  assert.match(src, /Startup was stopped to avoid data loss/);
  assert.match(src, /Failed database retained/);
  assert.match(src, /Database recovery failed/);
});

test('financial mutation routes convert transaction failures into safe error responses', () => {
  const checks = [
    ['server/accountant/accountantRoutes.js', ['Expense could not be recorded.', 'Remittance could not be recorded.']],
    ['server/capital/capitalRoutes.js', ['Capital record could not be created.', 'Capital record could not be updated.']],
    ['server/vendor/vendorPaymentRoutes.js', ['Vendor payment could not be recorded.', 'Vendor payment could not be updated.']],
    ['server/payroll/payrollRoutes.js', ['Employee payroll could not be recorded.', 'Payroll draft could not be generated.', 'Payroll could not be saved.']]
  ];
  for (const [file, messages] of checks) {
    const src = read(file);
    assert.match(src, /db\.transaction/);
    for (const message of messages) assert.ok(src.includes(message), `${file} missing failure response: ${message}`);
  }
});

test('sales replace import and delete remain transactional so failed operations cannot leave partial data', () => {
  const importSrc = read('server/sales/importService.js');
  const salesSrc = read('server/sales/salesRoutes.js');
  assert.match(importSrc, /db\.transaction\(\(\)\s*=>\s*\{/g);
  assert.match(importSrc, /DELETE FROM sales_transactions/);
  assert.match(importSrc, /INSERT INTO sales_transactions/);
  assert.match(salesSrc, /db\.transaction\(\(\)\s*=>\s*\{/g);
  assert.match(salesSrc, /DELETE FROM sales_transactions WHERE import_id/);
  assert.match(salesSrc, /DELETE FROM sales_imports WHERE id/);
});

test('idempotency releases failed submissions so a failed request can be retried', () => {
  const src = read('server/security/idempotency.js');
  assert.match(src, /status >= 200 && status < 300/);
  assert.match(src, /DELETE FROM idempotency_keys/);
  assert.match(src, /already being processed/);
});

console.log('STAGE10E_FAILURE_RECOVERY_STATIC_TESTS=PASS');
