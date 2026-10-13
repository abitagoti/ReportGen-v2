const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('business manager dashboard hides purchase and capital planning data', () => {
  const ui = read('public/js/pages/dashboard.js');
  const route = read('server/dashboard/dashboardRoutes.js');
  assert.match(ui, /const isBusinessManager=\(\)=>normalizedRole\(state\.user\?\.role\)==='business_manager';/);
  assert.match(ui, /const purchaseSection=!isBusinessManager\(\)&&fullMonth\?/);
  assert.match(route, /const businessManager = roleOf\(req\) === 'business_manager';/);
  assert.match(route, /if \(!businessManager\) totals\.purchases = currentPurchases;/);
  assert.match(route, /const planning = businessManager \? null/);
});

test('sales import keeps replace deletes and new import writes inside one transaction', () => {
  const src = read('server/sales/importService.js');
  const tx = src.match(/db\.transaction\(\(\)=>\{[\s\S]*?\}\)\(\);/);
  assert.ok(tx, 'sales import write block must be transactional');
  const block = tx[0];
  assert.match(block, /DELETE FROM sales_import_issues/);
  assert.match(block, /DELETE FROM sales_transactions/);
  assert.match(block, /UPDATE sales_imports SET status='replaced'/);
  assert.match(block, /INSERT INTO sales_imports/);
  assert.match(block, /INSERT INTO sales_transactions/);
  assert.match(block, /INSERT INTO sales_import_issues/);
});

test('sales import rejects partial replace before mutation begins', () => {
  const src = read('server/sales/importService.js');
  const guard = src.indexOf("e.code='PARTIAL_REPLACE_UNSAFE'");
  const tx = src.indexOf('db.transaction(() => {') >= 0 ? src.indexOf('db.transaction(() => {') : src.indexOf('db.transaction(()=>{');
  assert.ok(guard >= 0, 'partial replace guard must exist');
  assert.ok(tx > guard, 'partial replace validation must happen before transaction writes');
});

test('sales import delete is transactional', () => {
  const src = read('server/sales/salesRoutes.js');
  const start = src.indexOf('const remove=db.transaction');
  assert.ok(start >= 0);
  const block = src.slice(start, start + 700);
  assert.match(block, /DELETE FROM sales_transactions/);
  assert.match(block, /DELETE FROM sales_imports/);
});
