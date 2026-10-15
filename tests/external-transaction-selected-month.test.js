const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'public/js/pages/accountantSharedExpenses.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'server/accountant/accountantRoutes.js'), 'utf8');

test('new external transactions default to the selected reporting month and constrain the date picker', () => {
  assert.match(ui, /const monthDate=\(month\)=>/);
  assert.match(ui, /value="\$\{monthDate\(state\.dashboardMonth\|\|monthNow\(\)\)\}" min="\$\{monthBounds\(state\.dashboardMonth\|\|monthNow\(\)\)\.min\}" max="\$\{monthBounds\(state\.dashboardMonth\|\|monthNow\(\)\)\.max\}"/);
  assert.match(ui, /reportingMonth:state\.dashboardMonth\|\|monthNow\(\)/);
});

test('server rejects external transaction creation and edits outside the selected month', () => {
  assert.equal((routes.match(/String\(transactionDate\)\.slice\(0,7\)!==reportingMonth/g) || []).length, 2);
  assert.match(routes, /The transaction date must fall within the selected reporting month/);
});
