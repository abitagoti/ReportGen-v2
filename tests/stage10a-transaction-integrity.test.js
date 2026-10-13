const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function read(file){ return fs.readFileSync(path.join(root,file),'utf8'); }
function assert(condition,message){ if(!condition) throw new Error(message); }

// Stage 10A requires the mutation and its audit row to share the same transaction.
// This is a structural guard: if audit is moved after tx() again, the test fails.
const checks = [
  ['server/accountant/accountantRoutes.js', [
    'accountant.expense.created',
    'accountant.remittance.created'
  ]],
  ['server/capital/capitalRoutes.js', [
    'capital.created',
    'capital.updated',
    'capital.deleted'
  ]],
  ['server/vendor/vendorPaymentRoutes.js', [
    'vendor_payment.created',
    'vendor_payment.updated',
    'vendor_payment.deleted'
  ]],
  ['server/payroll/payrollRoutes.js', [
    'payroll.monthly_total.',
    'payroll.entry.created',
    'payroll.entry.updated',
    'payroll.generated',
    'payroll.saved',
    'payroll.marked_paid',
    'payroll.updated',
    'payroll.deleted',
    'staff.deduction.created',
    'staff.deduction.deleted',
    'payroll.loan.created',
    'payroll.loan_month.skipped',
    'payroll.loan_repayment.voided'
  ]]
];

for (const [file, actions] of checks) {
  const text = read(file);
  assert(text.includes('db.transaction'), `${file}: no transaction boundary found`);
  for (const action of actions) {
    const pos = text.indexOf(action);
    assert(pos >= 0, `${file}: missing ${action}`);
    const start = text.lastIndexOf('db.transaction', pos);
    assert(start >= 0, `${file}: ${action} is not inside a transaction`);
    const between = text.slice(start, pos);
    // A top-level tx() invocation between the transaction declaration and audit means
    // the audit was moved outside the transaction.
    assert(!/\n\s*tx\(\);/.test(between), `${file}: ${action} audit appears after transaction commit`);
  }
}

// Explicitly protect the new employee-level payroll boundary: creating a staff row,
// payroll entry, monthly total, and audit record must be one atomic operation.
const payroll = read('server/payroll/payrollRoutes.js');
const entryStart = payroll.indexOf("router.post('/api/payroll/entries'");
const entryEnd = payroll.indexOf("router.post('/api/payroll/generate'", entryStart);
const entryRoute = payroll.slice(entryStart, entryEnd);
assert(entryRoute.includes('const tx=db.transaction'), 'Employee payroll entry route lost its transaction boundary.');
assert(entryRoute.includes("action:existing?'payroll.entry.updated':'payroll.entry.created'"), 'Employee payroll entry audit missing.');
assert(entryRoute.indexOf('INSERT INTO payroll_employees') > entryRoute.indexOf('db.transaction'), 'New employee creation must occur inside the payroll transaction.');

console.log('STAGE10A_TRANSACTION_STRUCTURE_TEST_PASS');
