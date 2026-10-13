const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function read(file){ return fs.readFileSync(path.join(root,file),'utf8'); }
function assert(condition,message){ if(!condition) throw new Error(message); }

const reports = read('server/reports/reportsRoutes.js');
const dashboard = read('server/dashboard/dashboardRoutes.js');
const businesses = read('server/businesses/businessRoutes.js');
const businessPage = read('public/js/pages/businesses.js');

// All executive financial views must derive gross profit from sales less cost of goods.
assert(/const grossProfit = salesAmount - cost;/.test(reports), 'Owner report gross profit formula changed unexpectedly.');
assert(/const grossProfit = Number\(sales\.sales\|\|0\) - Number\(sales\.cost\|\|0\);/.test(dashboard), 'Dashboard gross profit formula changed unexpectedly.');
assert(/const grossProfit = Number\(summary\.sales\|\|0\)-costAmount;/.test(businesses), 'Business detail gross profit formula changed unexpectedly.');

// Net profit must consistently subtract operating expenses and payroll, plus owner allocation only for Owner reports.
assert(/const netProfit = grossProfit - expenseAmount - payroll - allocation\.ownerExpense;/.test(reports), 'Owner report net profit formula changed unexpectedly.');
assert(/const netProfit = grossProfit - Number\(expenses\.total\|\|0\) - payroll - ownerExpense;/.test(dashboard), 'Dashboard net profit formula changed unexpectedly.');
assert(/const netProfit = grossProfit-totalExpenses;/.test(businesses), 'Business detail net profit formula changed unexpectedly.');

// The business-detail API must distinguish imported profit from authoritative gross profit.
assert(/AS importedProfit/.test(businesses), 'Business detail must label imported profit separately.');
assert(/summary:\{[^}]*grossProfit,importedProfit:Number\(summary\.importedProfit/.test(businesses), 'Business detail summary must expose calculated gross profit and imported profit separately.');
assert(/grossProfit:Number\(x\.sales\|\|0\)-Number\(x\.cost\|\|0\)/.test(businesses), 'Business monthly/daily gross profit must be calculated from sales and cost.');

// UI must display the authoritative gross-profit field instead of the raw imported profit field.
assert(/<th>Gross profit<\/th>/.test(businessPage), 'Business detail monthly/customer tables must label gross profit explicitly.');
assert(/money\(x\.grossProfit\)/.test(businessPage), 'Business detail UI must render calculated gross profit.');

console.log('FINANCIAL_INTEGRITY_STATIC_TESTS=PASS');
