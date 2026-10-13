const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const critical = [
  ['server/accountant/accountantRoutes.js', ['accountant.expense.created', 'accountant.expense.deleted', 'accountant.remittance.created', 'accountant.remittance.deleted']],
  ['server/capital/capitalRoutes.js', ['capital.created', 'capital.updated', 'capital.deleted']],
  ['server/vendor/vendorPaymentRoutes.js', ['vendor_payment.created', 'vendor_payment.updated', 'vendor_payment.deleted']],
  ['server/sales/salesRoutes.js', ['sales.import.completed', 'sales.import.deleted', 'sales.template.created']],
  ['server/payroll/payrollRoutes.js', ['staff.created', 'staff.updated', 'staff.archived', 'staff.status.updated', 'payroll.monthly_total.', 'payroll.generated', 'payroll.saved', 'payroll.marked_paid', 'payroll.updated', 'payroll.deleted', 'staff.deduction.created', 'staff.deduction.deleted', 'payroll.loan.created', 'payroll.loan_month.skipped', 'payroll.loan_repayment.voided']],
  ['server/businesses/businessRoutes.js', ['business.created', 'business.updated']],
  ['server/users/userRoutes.js', ['user.created', 'user.deactivated', 'user.reactivated', 'user.business_access.updated']],
  ['server/organizationRoutes.js', ['organization.department.created', 'organization.department.updated', 'organization.department.deleted', 'organization.job_role.created', 'organization.job_role.updated', 'organization.job_role.deleted']],
  ['server/company/companyRoutes.js', ['company.updated']],
  ['server/dashboard/dashboardRoutes.js', ['owner_allocation.default.updated', 'owner_allocation.adjustment.updated', 'owner_allocation.updated', 'owner_allocation.reset']],
  ['server/permissionsRoutes.js', ['role.permissions.updated']],
  ['server/auth/authRoutes.js', ['user.password.changed']],
];

for (const [file, actions] of critical) {
  const text = read(file);
  assert(/require\(['"]\.\.?\/.*audit\/auditService['"]\)/.test(text) || text.includes("require('./audit/auditService')") || text.includes("require('../audit/auditService')"), `${file}: audit service is not imported`);
  for (const action of actions) assert(text.includes(`action:'${action}'`) || text.includes(`action: '${action}'`) || text.includes(action), `${file}: missing audit action ${action}`);
}

const auth = read('server/auth/authRoutes.js');
assert(!/audit\([^\n]*password/i.test(auth), 'auth audit call appears to include a password field');
assert(auth.includes("action: 'user.password.changed'"), 'password change audit is missing');

const auditService = read('server/audit/auditService.js');
assert(auditService.includes('business_id'), 'audit service must persist business_id');
assert(auditService.includes('ip_address'), 'audit service must persist IP address');
assert(auditService.includes('user_agent'), 'audit service must persist user agent');

console.log('AUDIT_TRAIL_TEST_PASS');

const schema = read('server/database/schema.sql');
assert(schema.includes('trg_audit_logs_no_update'), 'audit update protection trigger missing from schema');
assert(schema.includes('trg_audit_logs_no_delete'), 'audit delete protection trigger missing from schema');

const backupService = read('server/database/backupService.js');
assert(backupService.includes('verifyBackupFile'), 'backup verification function missing');
assert(backupService.includes('Backup checksum verification failed'), 'backup checksum verification missing');
assert(backupService.includes('Missing audit protection triggers'), 'backup validation must require audit protection triggers');
assert(backupService.includes('.manifest.json'), 'backup manifest is missing');

const database = read('server/database/database.js');
assert(database.includes('Staged database failed integrity_check'), 'staged restore integrity check missing');
assert(database.includes('Staged database is missing required audit protection trigger'), 'staged restore audit protection validation missing');
assert(database.includes('pre-import-${Date.now()}'), 'previous live database must be retained during restore');

const routes = read('server/database/databaseRoutes.js');
assert(routes.includes("/api/database/backups/:filename/verify"), 'backup verification endpoint missing');
assert(routes.includes("action: 'IMPORT'"), 'database restore audit event missing');
console.log('BACKUP_RECOVERY_INTEGRITY_TEST_PASS');
