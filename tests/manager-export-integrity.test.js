const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function read(file){ return fs.readFileSync(path.join(root,file),'utf8'); }
function assert(condition,message){ if(!condition) throw new Error(message); }

const reports = read('server/reports/reportsRoutes.js');

// Business Manager export content must come from server/database calculations,
// not client-supplied section HTML.
assert(/function trustedManagerData\(req, validation\)/.test(reports), 'Trusted Business Manager report source is missing.');
assert(/function trustedManagerSections\(req, body, validation\)/.test(reports), 'Trusted Business Manager section builder is missing.');
assert(/const sections = trustedManagerSections\(req, req\.body, validation\);/.test(reports), 'Manager Excel/Word exports must use trusted server-generated sections.');

// The old client-HTML section parser has been removed; exports must never take client-supplied HTML.
assert(!/function managerSections\(/.test(reports), 'The unused client-HTML section parser must stay removed.');
const exportUsesClientSections = /router\.post\('\/api\/reports\/export\/manager\/(?:excel|word)'[\s\S]*?const sections = managerSections\(req\.body\)/.test(reports);
assert(!exportUsesClientSections, 'Manager exports must not trust client-supplied HTML sections.');

// The server source must calculate the same financial primitives used elsewhere.
assert(/grossProfit = sales - costOfGoods/.test(reports), 'Trusted manager source must calculate gross profit from sales less cost.');
assert(/netProfit: grossProfit - expenseAmount - payroll/.test(reports), 'Trusted manager source must calculate net profit from authoritative values.');
assert(/SELECT COALESCE\(SUM\(returns_amount\),0\)/.test(reports), 'Trusted manager source must calculate returns from database records.');
assert(/SELECT transaction_date AS day,COALESCE\(SUM\(sales_amount\),0\)/.test(reports), 'Trusted manager source must calculate daily sales from database records.');

console.log('MANAGER_EXPORT_INTEGRITY_STATIC_TESTS=PASS');
