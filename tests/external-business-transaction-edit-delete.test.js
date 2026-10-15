const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('external-business transaction edit/delete endpoints are permission-checked and company/business scoped', () => {
  const routes = read('server/accountant/accountantRoutes.js');
  assert.match(routes, /router\.put\('\/api\/accountant\/external-businesses\/:id\/transactions\/:transactionId',requireAuth,requirePermission\('external_businesses\.manage'\)/);
  assert.match(routes, /router\.delete\('\/api\/accountant\/external-businesses\/:id\/transactions\/:transactionId',requireAuth,requirePermission\('external_businesses\.manage'\)/);
  assert.match(routes, /WHERE id=\? AND external_business_id=\? AND company_id=\?/);
  assert.match(routes, /validDate\(transactionDate\)/);
  assert.match(routes, /!\['earning','expense'\]\.includes\(transactionType\)/);
  assert.match(routes, /value<=0/);
});

test('shared-expense-linked transactions cannot be changed through ordinary transaction actions', () => {
  const routes = read('server/accountant/accountantRoutes.js');
  assert.match(routes, /if\(current\.sharedExpenseLineId\)return res\.status\(409\)/);
  const ui = read('public/js/pages/accountantSharedExpenses.js');
  assert.match(ui, /Managed by shared expense/);
});

test('external-business history exposes edit/delete for ordinary transactions and reloads after changes', () => {
  const ui = read('public/js/pages/accountantSharedExpenses.js');
  assert.match(ui, /function externalTransactionModal\(businessId,tx,onSaved\)/);
  assert.match(ui, /data-edit-external-transaction/);
  assert.match(ui, /data-delete-external-transaction/);
  assert.match(ui, /method:'PUT'.*external-businesses.*transactions/s);
  assert.match(ui, /method:'DELETE'.*external-businesses.*transactions/s);
  assert.match(ui, /loadExternalTransactionHistory\(business,target,month\)/);
});
