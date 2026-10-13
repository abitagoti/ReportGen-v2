const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dashboard = read('server/dashboard/dashboardRoutes.js');
const reports = read('server/reports/reportsRoutes.js');
const reportPage = read('public/js/pages/reports.js');

const checks = [
  ['Dashboard ownerAccess is Owner-only', /function ownerAccess\(req\)\{return roleOf\(req\)==='owner';\}/.test(dashboard)],
  ['Dashboard allocation write endpoints use ownerAccess', (dashboard.match(/if \(!ownerAccess\(req\)\)/g) || []).length >= 5],
  ['Report data calculates owner allocation only for Owner', /const includeOwnerAllocation = String\(req\.user\?\.role \|\| ''\)\.toLowerCase\(\) === 'owner';/.test(reports)],
  ['Non-owner report net profit excludes owner allocation', /if \(!ownerOnly\)[\s\S]*?row\.netProfit = Number\(row\.grossProfit \|\| 0\) - Number\(row\.expenses \|\| 0\) - Number\(row\.payroll \|\| 0\)/.test(reports)],
  ['Owner allocation export sheet is Owner-only', /if \(data\.includeOwnerAllocation\) \{[\s\S]*?workbook\.addWorksheet\('Owner Expense Allocation'\)/.test(reports)],
  ['Report UI gates owner allocation by Owner role', /const isOwnerRole=\(\)=>/.test(reportPage) && /isOwnerRole\(\)/.test(reportPage)],
  ['Report export omits owner columns for non-owners', /data\.includeOwnerAllocation \? \['Owner Expense'\]/.test(reports)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`Owner isolation checks passed: ${checks.length}`);
