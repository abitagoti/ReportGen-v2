'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'public/js/pages/accountantSharedExpenses.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'server/accountant/accountantRoutes.js'), 'utf8');

test('external business edit, archive/delete, and history handlers look up the clicked button ID', () => {
  assert.match(ui, /externalBusinesses\.find\(item=>item\.id===b\.dataset\.editExternal\)/);
  assert.match(ui, /externalBusinesses\.find\(item=>item\.id===b\.dataset\.archiveExternal\)/);
  assert.match(ui, /externalBusinesses\.find\(item=>item\.id===b\.dataset\.viewExternal\)/);
  assert.doesNotMatch(ui, /externalBusinesses\.find\(b=>b\.id===b\.dataset\.(?:editExternal|archiveExternal|viewExternal)\)/);
});

test('external business deletion is an archive operation that preserves history', () => {
  assert.match(ui, /data-archive-external/);
  assert.match(routes, /router\.delete\('\/api\/accountant\/external-businesses\/:id'/);
  assert.match(routes, /UPDATE external_businesses SET is_active=0/);
  assert.match(routes, /accountant\.external_business\.archived/);
});

test('shared expense create/edit/cancel and template create/edit/archive handlers remain wired', () => {
  for (const token of ['data-modal-save-expense', 'data-modal-save-template', 'data-edit-shared-expense', 'data-cancel-shared-expense', 'data-edit-shared-template', 'data-archive-shared-template']) {
    assert.ok(ui.includes(token), `Missing UI action ${token}`);
  }
  for (const route of [
    "router.post('/api/accountant/shared-expenses'",
    "router.put('/api/accountant/shared-expenses/:id'",
    "router.delete('/api/accountant/shared-expenses/:id'",
    "router.post('/api/accountant/shared-expense-templates'",
    "router.put('/api/accountant/shared-expense-templates/:id'",
    "router.delete('/api/accountant/shared-expense-templates/:id'"
  ]) assert.ok(routes.includes(route), `Missing API route ${route}`);
});

test('external transaction and shared expense APIs enforce accountant permissions for mutations', () => {
  assert.match(routes, /router\.post\('\/api\/accountant\/external-businesses\/:id\/transactions',requireAuth,requirePermission\('expenses\.manage'\)/);
  assert.match(routes, /router\.post\('\/api\/accountant\/shared-expenses',requireAuth,requirePermission\('expenses\.manage'\)/);
  assert.match(routes, /router\.put\('\/api\/accountant\/shared-expenses\/:id',requireAuth,requirePermission\('expenses\.manage'\)/);
});
