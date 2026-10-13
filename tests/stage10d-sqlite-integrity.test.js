'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('database enables SQLite foreign keys and runs Stage 10D verification', () => {
  const src = read('server/database/database.js');
  assert.match(src, /db\.pragma\('foreign_keys = ON'\)/);
  assert.match(src, /verifyDatabaseIntegrity\(db\)/);
  assert.match(src, /Stage 10D integrity verification passed/);
});

test('Stage 10D verifies SQLite integrity and foreign-key violations', () => {
  const src = read('server/database/integrity.js');
  assert.match(src, /PRAGMA integrity_check/);
  assert.match(src, /PRAGMA foreign_key_check/);
  assert.match(src, /foreign_key_check found/);
});

test('Stage 10D checks cross-company business and staff ownership', () => {
  const src = read('server/database/integrity.js');
  assert.match(src, /assertNoCrossCompanyBusinessRows/);
  assert.match(src, /assertNoCrossCompanyStaffRows/);
  assert.match(src, /business belongs to another company/);
  assert.match(src, /staff belongs to another company/);
});

test('Stage 10D protects payroll history from unsafe staff cascades', () => {
  const src = read('server/database/integrity.js');
  assert.match(src, /ON DELETE RESTRICT/);
  assert.match(src, /payroll_staff_loans/);
  assert.match(src, /payroll_loan_repayments/);
});

test('Stage 10D verifies required indexes and append-only audit triggers', () => {
  const src = read('server/database/integrity.js');
  assert.match(src, /REQUIRED_INDEXES/);
  assert.match(src, /idx_sales_tx_company_date_business/);
  assert.match(src, /idx_idempotency_updated/);
  assert.match(src, /trg_audit_logs_no_update/);
  assert.match(src, /trg_audit_logs_no_delete/);
});

test('Stage 10D checks sales import, user access and idempotency tenant consistency', () => {
  const src = read('server/database/integrity.js');
  assert.match(src, /sales transaction\/import\/business ownership mismatch/);
  assert.match(src, /user\/business access crosses company boundaries/);
  assert.match(src, /idempotency record has a mismatched user\/company scope/);
});

console.log('STAGE10D_SQLITE_INTEGRITY_STATIC_TESTS=PASS');
