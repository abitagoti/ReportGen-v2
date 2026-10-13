const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

test('idempotency storage is company/user/route/key scoped and fingerprints request data', () => {
  const src = read('server/database/database.js');
  assert.match(src, /CREATE TABLE IF NOT EXISTS idempotency_keys/);
  assert.match(src, /PRIMARY KEY\(company_id,user_id,route,key\)/);
  assert.match(src, /request_hash TEXT NOT NULL/);
});

test('idempotency middleware replays completed responses and rejects payload changes', () => {
  const src = read('server/security/idempotency.js');
  assert.match(src, /request_hash/);
  assert.match(src, /status === 'completed'/);
  assert.match(src, /different request data/);
  assert.match(src, /status='completed'/);
  assert.match(src, /DELETE FROM idempotency_keys/);
});

test('financial creation endpoints opt into idempotency protection', () => {
  const checks = [
    ['server/accountant/accountantRoutes.js', ['/api/accountant/expenses', '/api/accountant/remittances']],
    ['server/capital/capitalRoutes.js', ['/api/capital']],
    ['server/vendor/vendorPaymentRoutes.js', ['/api/vendor-payments']],
    ['server/payroll/payrollRoutes.js', ['/api/payroll/staff', '/api/payroll/staff/salary-increase', '/api/payroll/monthly-total', '/api/payroll/entries', '/api/payroll/generate', '/api/payroll/:id/save', '/api/payroll/:id/paid', '/api/payroll/deductions', '/api/payroll/loans']],
    ['server/sales/salesRoutes.js', ['/api/sales/imports']]
  ];
  for (const [file, routes] of checks) {
    const src = read(file);
    assert.match(src, /requireIdempotency/);
    for (const route of routes) {
      const i = src.indexOf(route, Math.max(0, src.indexOf(`router.post('${route}'`)));
      assert.ok(i >= 0, `${file} missing ${route}`);
      const segment = src.slice(Math.max(0, i - 120), i + route.length + 120);
      assert.match(segment, /requireIdempotency/, `${file} route ${route} is not protected`);
    }
  }
});

test('client API supports explicit idempotency keys without changing ordinary requests', () => {
  const src = read('public/js/api.js');
  assert.match(src, /newIdempotencyKey/);
  assert.match(src, /Idempotency-Key/);
  assert.match(src, /opts\.idempotencyKey/);
});

test('sales import resets its submission key after a successful import', () => {
  const src = read('public/js/pages/import.js');
  assert.match(src, /state\.importIdempotencyKey=null/);
  assert.match(src, /newIdempotencyKey\('sales-import'\)/);
});
