const express = require('express');
const { db } = require('../database/database');
const { requireAuth, requirePermission } = require('../auth/middleware');
const { hasPermission } = require('../permissions');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { audit } = require('../audit/auditService');
const { requireIdempotency } = require('../security/idempotency');

const router = express.Router();

// Lightweight monthly payroll totals for external businesses; does not touch linked-business payroll.
db.exec(`CREATE TABLE IF NOT EXISTS external_business_payroll_monthly (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, external_business_id TEXT NOT NULL REFERENCES external_businesses(id) ON DELETE RESTRICT, payroll_month TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0), notes TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(company_id, external_business_id, payroll_month)); CREATE INDEX IF NOT EXISTS idx_external_payroll_month ON external_business_payroll_monthly(company_id,payroll_month,external_business_id);`);
const companyWide = ['owner', 'general_manager', 'administrator', 'admin'];

function isAccountant(req) { return String(req.user.role || '').toLowerCase() === 'accountant'; }
function assignedBusinessIds(req) {
  if (companyWide.includes(String(req.user.role || '').toLowerCase())) {
    return db.prepare('SELECT id FROM businesses WHERE company_id=? AND is_active=1').all(req.user.company_id).map(x => x.id);
  }
  return db.prepare(`SELECT b.id FROM businesses b JOIN user_business_access a ON a.business_id=b.id WHERE b.company_id=? AND b.is_active=1 AND a.user_id=?`).all(req.user.company_id, req.user.user_id).map(x => x.id);
}
function validMonth(value) { return /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : new Date().toISOString().slice(0, 7); }
function monthRange(month) { const last = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).getUTCDate(); return [`${month}-01`, `${month}-${String(last).padStart(2,'0')}`]; }
function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return false;const [y,m,d]=String(value).split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;}
function selectedRange(req,month){const [defaultStart,defaultEnd]=monthRange(month);const start=validDate(req.query.start)?String(req.query.start):defaultStart,end=validDate(req.query.end)?String(req.query.end):defaultEnd;return start<=end?[start,end]:null;}

router.get('/api/accountant/monthly-summary', requireAuth, requirePermission('dashboard.view'), (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const month = validMonth(req.query.month);
  const range=selectedRange(req,month);if(!range)return res.status(400).json({error:'Choose a valid start and end date.'});const [monthStart, monthEnd] = range;
  const ids = assignedBusinessIds(req);
  if (!ids.length) return res.json({ month, start:monthStart, end:monthEnd, businesses: [] });
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT b.id AS businessId, b.name AS businessName,
      COALESCE((SELECT SUM(t.sales_amount) FROM sales_transactions t JOIN sales_imports si ON si.id=t.import_id AND si.status IN ('completed','completed_with_warnings') WHERE t.business_id=b.id AND t.transaction_date BETWEEN ? AND ?),0) AS sales,
      COALESCE((SELECT SUM(t.gross_amount) FROM sales_transactions t JOIN sales_imports si ON si.id=t.import_id AND si.status IN ('completed','completed_with_warnings') WHERE t.business_id=b.id AND t.transaction_date BETWEEN ? AND ?),0) AS gross,
      COALESCE((SELECT SUM(t.returns_amount) FROM sales_transactions t JOIN sales_imports si ON si.id=t.import_id AND si.status IN ('completed','completed_with_warnings') WHERE t.business_id=b.id AND t.transaction_date BETWEEN ? AND ?),0) AS returns,
      COALESCE((SELECT SUM(t.cost_amount) FROM sales_transactions t JOIN sales_imports si ON si.id=t.import_id AND si.status IN ('completed','completed_with_warnings') WHERE t.business_id=b.id AND t.transaction_date BETWEEN ? AND ?),0) AS cost,
      COALESCE((SELECT SUM(t.profit_amount) FROM sales_transactions t JOIN sales_imports si ON si.id=t.import_id AND si.status IN ('completed','completed_with_warnings') WHERE t.business_id=b.id AND t.transaction_date BETWEEN ? AND ?),0) AS profit,
      COALESCE((SELECT COUNT(t.id) FROM sales_transactions t JOIN sales_imports si ON si.id=t.import_id AND si.status IN ('completed','completed_with_warnings') WHERE t.business_id=b.id AND t.transaction_date BETWEEN ? AND ?),0) AS transactionCount,
       COALESCE((SELECT SUM(r.amount) FROM accountant_remittances r WHERE r.company_id=b.company_id AND r.business_id=b.id AND r.remittance_date BETWEEN ? AND ?),0) AS remittanceTotal,
       COALESCE((SELECT SUM(e.amount) FROM accountant_expenses e WHERE e.company_id=b.company_id AND e.business_id=b.id AND e.expense_date BETWEEN ? AND ?),0) AS expenseTotal,
       COALESCE((SELECT SUM(CASE WHEN p.calculation_mode='employees' THEN COALESCE((SELECT SUM(pe.gross_amount) FROM payroll_entries pe WHERE pe.business_id=b.id AND pe.company_id=p.company_id AND pe.payroll_month=p.payroll_month),0) ELSE p.amount END) FROM payroll_monthly_totals p WHERE p.business_id=b.id AND p.company_id=b.company_id AND p.payroll_month BETWEEN ? AND ? AND p.status='saved'),0) AS payrollTotal
    FROM businesses b
    WHERE b.company_id=? AND b.id IN (${placeholders})
    ORDER BY b.name
  `).all(monthStart,monthEnd,monthStart,monthEnd,monthStart,monthEnd,monthStart,monthEnd,monthStart,monthEnd,monthStart,monthEnd,monthStart,monthEnd,monthStart,monthEnd,monthStart.slice(0,7),monthEnd.slice(0,7),req.user.company_id,...ids);
  res.json({ month, start:monthStart, end:monthEnd, businesses: rows });
});

router.get('/api/accountant/expenses', requireAuth, requirePermission('expenses.view'), (req, res) => {
  if (!isAccountant(req) && !companyWide.includes(String(req.user.role || '').toLowerCase())) return res.status(403).json({ error: 'This workspace is restricted.' });
  const ids = assignedBusinessIds(req);
  const businessId = String(req.query.businessId || '');
  const month = validMonth(req.query.month);
  const range=selectedRange(req,month);if(!range)return res.status(400).json({error:'Choose a valid start and end date.'});const [monthStart, monthEnd] = range;
  if (businessId && !ids.includes(businessId)) return res.status(403).json({ error: 'You are not assigned to this business.' });
  const placeholders = ids.map(() => '?').join(',');
  if (!ids.length) return res.json({ month, expenses: [] });
  const filter = businessId ? ' AND e.business_id=?' : '';
  const params = [req.user.company_id,req.user.company_id, monthStart, monthEnd, ...ids];
  if (businessId) params.push(businessId);
  const rows = db.prepare(`SELECT e.id,e.business_id AS businessId,b.name AS businessName,e.expense_date AS expenseDate,e.category,e.description,e.amount,e.notes,e.shared_expense_id AS sharedExpenseId,e.created_at AS createdAt FROM accountant_expenses e JOIN businesses b ON b.id=e.business_id WHERE b.company_id=? AND e.company_id=? AND e.expense_date BETWEEN ? AND ? AND e.business_id IN (${placeholders})${filter} ORDER BY e.expense_date DESC,e.created_at DESC`).all(...params);
  res.json({ month, start:monthStart, end:monthEnd, businessId: businessId || null, expenses: rows });
});

router.get('/api/manager/expenses', requireAuth, (req, res) => {
  // Assigned-business expense view for every role that is not company-wide and not the Accountant (Business Manager, Viewer).
  const roleName = String(req.user.role || '').toLowerCase();
  if (companyWide.includes(roleName) || roleName === 'accountant') return res.status(403).json({ error: 'This workspace is not available for your role.' });
  if (!hasPermission(req, 'expenses.view')) return res.status(403).json({ error: 'You do not have permission for this action.' });
  const month = validMonth(req.query.month);
  const range=selectedRange(req,month);if(!range)return res.status(400).json({error:'Choose a valid start and end date.'});const [monthStart, monthEnd] = range;
  const ids = assignedBusinessIds(req);
  if (!ids.length) return res.json({ month, expenses: [] });
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT e.id,e.business_id AS businessId,b.name AS businessName,e.expense_date AS expenseDate,
      e.category,e.description,e.amount,e.notes,e.shared_expense_id AS sharedExpenseId,e.created_at AS createdAt
    FROM accountant_expenses e
    JOIN businesses b ON b.id=e.business_id
    WHERE e.company_id=? AND e.expense_date BETWEEN ? AND ? AND e.business_id IN (${placeholders})
    ORDER BY e.expense_date DESC,e.created_at DESC
  `).all(req.user.company_id, monthStart, monthEnd, ...ids);
  res.json({ month, start:monthStart, end:monthEnd, expenses: rows });
});

router.get('/api/owner/expenses', requireAuth, (req, res) => {
  if (!companyWide.includes(String(req.user.role || '').toLowerCase())) return res.status(403).json({ error: 'Owner access required.' });
  // Company-wide scope comes from the role; the feature itself still follows the permission so a Deny override applies.
  if (!hasPermission(req, 'expenses.view')) return res.status(403).json({ error: 'You do not have permission for this action.' });
  const month = validMonth(req.query.month);
  const range=selectedRange(req,month);if(!range)return res.status(400).json({error:'Choose a valid start and end date.'});const [monthStart, monthEnd] = range;
  const rows = db.prepare(`
    SELECT e.id,e.business_id AS businessId,b.name AS businessName,e.expense_date AS expenseDate,
      e.category,e.description,e.amount,e.notes,e.shared_expense_id AS sharedExpenseId,e.created_by AS createdBy,e.created_at AS createdAt
    FROM accountant_expenses e
    JOIN businesses b ON b.id=e.business_id
    WHERE e.company_id=? AND e.expense_date BETWEEN ? AND ?
    ORDER BY e.expense_date DESC,e.created_at DESC
  `).all(req.user.company_id, monthStart, monthEnd);
  res.json({ month, start:monthStart, end:monthEnd, expenses: rows });
});

router.get('/api/owner/expense-summary', requireAuth, (req, res) => {
  if (!companyWide.includes(String(req.user.role || '').toLowerCase())) return res.status(403).json({ error: 'Owner access required.' });
  // The summary feeds both the Dashboard and the Expenses page.
  if (!hasPermission(req, 'expenses.view') && !hasPermission(req, 'dashboard.view')) return res.status(403).json({ error: 'You do not have permission for this action.' });
  const month = validMonth(req.query.month);
  const range=selectedRange(req,month);if(!range)return res.status(400).json({error:'Choose a valid start and end date.'});const [monthStart, monthEnd] = range;
  const total = db.prepare("SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM accountant_expenses WHERE company_id=? AND expense_date BETWEEN ? AND ?").get(req.user.company_id, monthStart, monthEnd);
  const byBusiness = db.prepare(`SELECT e.business_id AS businessId,b.name AS businessName,COALESCE(SUM(e.amount),0) AS total,COUNT(e.id) AS count
    FROM accountant_expenses e JOIN businesses b ON b.id=e.business_id
    WHERE e.company_id=? AND e.expense_date BETWEEN ? AND ?
    GROUP BY e.business_id,b.name ORDER BY total DESC`).all(req.user.company_id, monthStart, monthEnd);
  res.json({month,start:monthStart,end:monthEnd,total:Number(total.total||0),count:Number(total.count||0),byBusiness});
});

router.post('/api/accountant/expenses', requireAuth, requirePermission('expenses.manage'), requireIdempotency, (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const { businessId, expenseDate, category, description, amount, notes } = req.body || {};
  const ids = assignedBusinessIds(req);
  if (!businessId || !ids.includes(String(businessId))) return res.status(403).json({ error: 'You are not assigned to this business.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expenseDate || ''))) return res.status(400).json({ error: 'A valid expense date is required.' });
  const numericAmount = Number(amount);
  if (!category || !Number.isFinite(numericAmount) || numericAmount <= 0) return res.status(400).json({ error: 'An expense item and a positive amount are required.' });
  const business = db.prepare('SELECT id FROM businesses WHERE id=? AND company_id=? AND is_active=1').get(businessId, req.user.company_id);
  if (!business) return res.status(404).json({ error: 'Business not found.' });
  const expenseId = id('exp');
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO accountant_expenses(id,company_id,business_id,expense_date,category,description,amount,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(expenseId,req.user.company_id,businessId,expenseDate,String(category).trim(),String(description || category).trim(),numericAmount,notes?String(notes).trim():null,req.user.user_id,nowIso());
    audit(req,{action:'accountant.expense.created',entityType:'accountant_expense',entityId:expenseId,businessId:String(businessId),details:{expenseDate,category:String(category).trim(),amount:numericAmount}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Expense could not be recorded.'});}
  res.status(201).json({ id: expenseId, message: 'Expense recorded.' });
});

router.delete('/api/accountant/expenses/:id', requireAuth, requirePermission('expenses.manage'), (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const ids = assignedBusinessIds(req);
  if (!ids.length) return res.status(404).json({ error: 'Expense not found.' });
  const placeholders = ids.map(() => '?').join(',');
  const current=db.prepare(`SELECT id,business_id AS businessId,expense_date AS expenseDate,category,amount,shared_expense_id AS sharedExpenseId FROM accountant_expenses WHERE id=? AND company_id=? AND business_id IN (${placeholders})`).get(req.params.id,req.user.company_id,...ids);
  if (!current) return res.status(404).json({ error: 'Expense not found in your assigned businesses.' });
  if (current.sharedExpenseId) return res.status(409).json({ error: 'This expense belongs to a shared allocation. Edit or cancel it from Shared Expenses.' });
  db.transaction(()=>{db.prepare('DELETE FROM accountant_expenses WHERE id=? AND company_id=?').run(current.id,req.user.company_id);audit(req,{action:'accountant.expense.deleted',entityType:'accountant_expense',entityId:current.id,businessId:current.businessId,details:{expenseDate:current.expenseDate,category:current.category,amount:Number(current.amount||0)}});})();
  res.json({ message: 'Expense deleted.' });
});

router.get('/api/accountant/expense-templates', requireAuth, requirePermission('expenses.view'), (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const rows = db.prepare('SELECT id,name,description,created_at AS createdAt FROM accountant_expense_templates WHERE company_id=? AND is_active=1 ORDER BY name').all(req.user.company_id);
  res.json({ templates: rows });
});

router.post('/api/accountant/expense-templates', requireAuth, requirePermission('expenses.manage'), (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim() || null;
  if (!name) return res.status(400).json({ error: 'Expense name is required.' });
  const existing = db.prepare('SELECT id FROM accountant_expense_templates WHERE company_id=? AND lower(name)=lower(?) AND is_active=1').get(req.user.company_id, name);
  if (existing) return res.status(409).json({ error: 'That expense item already exists.' });
  const templateId = id('expt');
  db.prepare('INSERT INTO accountant_expense_templates(id,company_id,name,description,created_by,created_at) VALUES(?,?,?,?,?,?)').run(templateId, req.user.company_id, name, description, req.user.user_id, nowIso());
  audit(req,{action:'accountant.expense_template.created',entityType:'accountant_expense_template',entityId:templateId,details:{name}});
  res.status(201).json({ id: templateId, message: 'Expense item created.' });
});

router.put('/api/accountant/expense-templates/:id', requireAuth, requirePermission('expenses.manage'), (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const templateId = String(req.params.id || '');
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim() || null;
  if (!name) return res.status(400).json({ error: 'Expense name is required.' });
  const current = db.prepare('SELECT id,name,description FROM accountant_expense_templates WHERE id=? AND company_id=? AND is_active=1').get(templateId, req.user.company_id);
  if (!current) return res.status(404).json({ error: 'Reusable expense item not found.' });
  const duplicate = db.prepare('SELECT id FROM accountant_expense_templates WHERE company_id=? AND lower(name)=lower(?) AND id<>? AND is_active=1').get(req.user.company_id, name, templateId);
  if (duplicate) return res.status(409).json({ error: 'That expense item already exists.' });
  db.prepare('UPDATE accountant_expense_templates SET name=?,description=? WHERE id=? AND company_id=?').run(name, description, templateId, req.user.company_id);
  audit(req,{action:'accountant.expense_template.updated',entityType:'accountant_expense_template',entityId:templateId,details:{before:current,after:{name,description}}});
  res.json({ message: 'Expense item updated.' });
});

router.delete('/api/accountant/expense-templates/:id', requireAuth, requirePermission('expenses.manage'), (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const templateId = String(req.params.id || '');
  const current = db.prepare('SELECT id,name,description FROM accountant_expense_templates WHERE id=? AND company_id=? AND is_active=1').get(templateId, req.user.company_id);
  if (!current) return res.status(404).json({ error: 'Reusable expense item not found.' });
  // Soft-delete the shared reusable option; historical transactions retain their own description/category.
  db.prepare('UPDATE accountant_expense_templates SET is_active=0 WHERE id=? AND company_id=?').run(templateId, req.user.company_id);
  audit(req,{action:'accountant.expense_template.deleted',entityType:'accountant_expense_template',entityId:templateId,details:{name:current.name,description:current.description,softDeleted:true}});
  res.json({ message: 'Reusable expense item removed. Historical expenses were preserved.' });
});

router.get('/api/accountant/remittances', requireAuth, requirePermission('expenses.view'), (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const ids = assignedBusinessIds(req);
  const businessId = String(req.query.businessId || '');
  const month = validMonth(req.query.month);
  const range=selectedRange(req,month);if(!range)return res.status(400).json({error:'Choose a valid start and end date.'});const [monthStart, monthEnd] = range;
  if (!businessId || !ids.includes(businessId)) return res.status(403).json({ error: 'You are not assigned to this business.' });
  const rows = db.prepare(`SELECT id,remittance_date AS remittanceDate,description,amount,notes,created_at AS createdAt FROM accountant_remittances WHERE company_id=? AND business_id=? AND remittance_date BETWEEN ? AND ? ORDER BY remittance_date DESC,created_at DESC`).all(req.user.company_id,businessId,monthStart,monthEnd);
  res.json({ month, start:monthStart, end:monthEnd, businessId, remittances: rows });
});

router.post('/api/accountant/remittances', requireAuth, requirePermission('expenses.manage'), requireIdempotency, (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const { businessId, remittanceDate, description, amount, notes } = req.body || {};
  const ids = assignedBusinessIds(req);
  if (!businessId || !ids.includes(String(businessId))) return res.status(403).json({ error: 'You are not assigned to this business.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(remittanceDate || ''))) return res.status(400).json({ error: 'A valid remittance date is required.' });
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return res.status(400).json({ error: 'A positive remittance amount is required.' });
  const business = db.prepare('SELECT id FROM businesses WHERE id=? AND company_id=? AND is_active=1').get(businessId, req.user.company_id);
  if (!business) return res.status(404).json({ error: 'Business not found.' });
  const remittanceId = id('rem');
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO accountant_remittances(id,company_id,business_id,remittance_date,description,amount,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(remittanceId,req.user.company_id,businessId,remittanceDate,String(description || "Excess from cashiers' remittances").trim(),numericAmount,notes?String(notes).trim():null,req.user.user_id,nowIso());
    audit(req,{action:'accountant.remittance.created',entityType:'accountant_remittance',entityId:remittanceId,businessId:String(businessId),details:{remittanceDate,description:String(description || "Excess from cashiers' remittances").trim(),amount:numericAmount}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Remittance could not be recorded.'});}
  res.status(201).json({ id: remittanceId, message: 'Remittance excess recorded.' });
});

router.delete('/api/accountant/remittances/:id', requireAuth, requirePermission('expenses.manage'), (req, res) => {
  if (!isAccountant(req)) return res.status(403).json({ error: 'This workspace is available to accountants.' });
  const ids = assignedBusinessIds(req);
  if (!ids.length) return res.status(404).json({ error: 'Remittance record not found.' });
  const placeholders = ids.map(() => '?').join(',');
  const current=db.prepare(`SELECT id,business_id AS businessId,remittance_date AS remittanceDate,description,amount FROM accountant_remittances WHERE id=? AND company_id=? AND business_id IN (${placeholders})`).get(req.params.id,req.user.company_id,...ids);
  if (!current) return res.status(404).json({ error: 'Remittance record not found in your assigned businesses.' });
  db.transaction(()=>{db.prepare('DELETE FROM accountant_remittances WHERE id=? AND company_id=?').run(current.id,req.user.company_id);audit(req,{action:'accountant.remittance.deleted',entityType:'accountant_remittance',entityId:current.id,businessId:current.businessId,details:{remittanceDate:current.remittanceDate,description:current.description,amount:Number(current.amount||0)}});})();
  res.json({ message: 'Remittance record deleted.' });
});



// Shared expense allocation workspace. Linked allocations are mirrored into the existing
// accountant_expenses ledger so all business and owner reports continue using one source.
function requireAccountantWorkspace(req,res){return true;}
function requireSharedRead(req,res,permission){if(hasPermission(req,permission))return true;res.status(403).json({error:'You do not have permission to view these records.'});return false;}
function requireExternalRead(req,res){if(hasPermission(req,'external_businesses.view'))return true;res.status(403).json({error:'You do not have permission to view external businesses.'});return false;}
function allocationBusinessList(companyId, ids){
  const linked=ids.length?db.prepare(`SELECT id,name,'linked' AS businessType FROM businesses WHERE company_id=? AND is_active=1 AND id IN (${ids.map(()=>'?').join(',')}) ORDER BY name`).all(companyId,...ids):[];
  const external=db.prepare("SELECT id,name,'external' AS businessType FROM external_businesses WHERE company_id=? AND is_active=1 ORDER BY name").all(companyId);
  return [...linked,...external].sort((a,b)=>a.name.localeCompare(b.name));
}
router.get('/api/accountant/shared-businesses',requireAuth,(req,res)=>{
  if(!requireSharedRead(req,res,'shared_expenses.view'))return;
  res.json({businesses:allocationBusinessList(req.user.company_id,assignedBusinessIds(req))});
});
router.get('/api/accountant/external-businesses',requireAuth,(req,res)=>{
  if(!requireExternalRead(req,res))return;
  const rows=db.prepare(`SELECT x.id,x.name,x.description,x.is_active AS isActive,x.created_at AS createdAt,
    COALESCE((SELECT SUM(t.amount) FROM external_business_transactions t WHERE t.external_business_id=x.id AND t.company_id=x.company_id AND t.transaction_type='earning' AND substr(t.transaction_date,1,7)=?),0) AS monthlyEarnings,
    COALESCE((SELECT SUM(t.amount) FROM external_business_transactions t WHERE t.external_business_id=x.id AND t.company_id=x.company_id AND t.transaction_type='expense' AND substr(t.transaction_date,1,7)=?),0) AS monthlyExpenses,
    COALESCE((SELECT p.amount FROM external_business_payroll_monthly p WHERE p.external_business_id=x.id AND p.company_id=x.company_id AND p.payroll_month=?),0) AS monthlyPayroll
    FROM external_businesses x WHERE x.company_id=? AND (?=1 OR x.is_active=1) ORDER BY x.is_active DESC,x.name`).all(validMonth(req.query.month),validMonth(req.query.month),validMonth(req.query.month),req.user.company_id,String(req.query.includeArchived||'')==='1'?1:0);
  res.json({businesses:rows});
});
router.post('/api/accountant/external-businesses',requireAuth,requirePermission('external_businesses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;
  const name=String(req.body?.name||'').trim(),description=String(req.body?.description||'').trim()||null;
  if(!name)return res.status(400).json({error:'External business name is required.'});
  if(db.prepare('SELECT id FROM businesses WHERE company_id=? AND lower(name)=lower(?) AND is_active=1').get(req.user.company_id,name))return res.status(409).json({error:'A ReportGen-linked business already uses that name. Select it from the linked business list.'});
  if(db.prepare('SELECT id FROM external_businesses WHERE company_id=? AND lower(name)=lower(?)').get(req.user.company_id,name))return res.status(409).json({error:'An external business with that name already exists.'});
  const businessId=id('extbiz'),now=nowIso();db.prepare('INSERT INTO external_businesses(id,company_id,name,description,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(businessId,req.user.company_id,name,description,req.user.user_id,now,now);
  audit(req,{action:'accountant.external_business.created',entityType:'external_business',entityId:businessId,details:{name}});res.status(201).json({id:businessId,message:'External business created.'});
});
router.put('/api/accountant/external-businesses/:id',requireAuth,requirePermission('external_businesses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;const name=String(req.body?.name||'').trim(),description=String(req.body?.description||'').trim()||null;
  const current=db.prepare('SELECT id,name,description FROM external_businesses WHERE id=? AND company_id=? AND is_active=1').get(req.params.id,req.user.company_id);
  if(!current)return res.status(404).json({error:'External business not found.'});if(!name)return res.status(400).json({error:'Business name is required.'});
  if(db.prepare('SELECT id FROM external_businesses WHERE company_id=? AND lower(name)=lower(?) AND id<>?').get(req.user.company_id,name,current.id))return res.status(409).json({error:'Another external business already uses that name.'});
  db.prepare('UPDATE external_businesses SET name=?,description=?,updated_at=? WHERE id=? AND company_id=?').run(name,description,nowIso(),current.id,req.user.company_id);
  audit(req,{action:'accountant.external_business.updated',entityType:'external_business',entityId:current.id,details:{before:current,after:{name,description}}});res.json({message:'External business updated.'});
});
router.post('/api/accountant/external-businesses/:id/archive',requireAuth,requirePermission('external_businesses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;const current=db.prepare('SELECT id,name FROM external_businesses WHERE id=? AND company_id=? AND is_active=1').get(req.params.id,req.user.company_id);if(!current)return res.status(404).json({error:'Active external business not found.'});
  db.prepare('UPDATE external_businesses SET is_active=0,updated_at=? WHERE id=? AND company_id=?').run(nowIso(),current.id,req.user.company_id);audit(req,{action:'accountant.external_business.archived',entityType:'external_business',entityId:current.id,details:{name:current.name}});res.json({message:'External business archived. Transactions and historical allocations were preserved.'});
});
router.delete('/api/accountant/external-businesses/:id',requireAuth,requirePermission('external_businesses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;const current=db.prepare('SELECT id,name FROM external_businesses WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);if(!current)return res.status(404).json({error:'External business not found.'});
  const txCount=Number(db.prepare('SELECT COUNT(*) AS n FROM external_business_transactions WHERE company_id=? AND external_business_id=?').get(req.user.company_id,current.id).n);
  if(txCount>0)return res.status(409).json({error:`This business has ${txCount} transaction record(s). Permanently delete is blocked until every transaction has been removed or voided.`});
  const allocationCount=Number(db.prepare("SELECT COUNT(*) AS n FROM shared_expense_lines WHERE company_id=? AND business_type='external' AND business_id=?").get(req.user.company_id,current.id).n);
  if(allocationCount>0)return res.status(409).json({error:'This business has shared-expense allocation history. It cannot be permanently deleted; archive it to preserve the audit trail.'});
  db.prepare('DELETE FROM external_businesses WHERE id=? AND company_id=?').run(current.id,req.user.company_id);audit(req,{action:'accountant.external_business.permanently_deleted',entityType:'external_business',entityId:current.id,details:{name:current.name,transactionCount:txCount,allocationCount}});res.json({message:'External business permanently deleted.'});
});
router.get('/api/accountant/external-businesses/:id/payroll',requireAuth,(req,res)=>{
  if(!requireExternalRead(req,res))return;const b=db.prepare('SELECT id FROM external_businesses WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);if(!b)return res.status(404).json({error:'External business not found.'});const month=validMonth(req.query.month);const row=db.prepare('SELECT id,amount,notes,payroll_month AS month FROM external_business_payroll_monthly WHERE company_id=? AND external_business_id=? AND payroll_month=?').get(req.user.company_id,b.id,month);res.json({month,payroll:row||{amount:0,notes:''}});
});
router.put('/api/accountant/external-businesses/:id/payroll',requireAuth,requirePermission('external_businesses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;const b=db.prepare('SELECT id,name FROM external_businesses WHERE id=? AND company_id=? AND is_active=1').get(req.params.id,req.user.company_id);if(!b)return res.status(404).json({error:'Active external business not found.'});const month=String(req.body?.month||'');const amount=Number(req.body?.amount);const notes=String(req.body?.notes||'').trim()||null;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!Number.isFinite(amount)||amount<0)return res.status(400).json({error:'Enter a valid month and a payroll amount of zero or more.'});const existing=db.prepare('SELECT id FROM external_business_payroll_monthly WHERE company_id=? AND external_business_id=? AND payroll_month=?').get(req.user.company_id,b.id,month);const now=nowIso();if(existing)db.prepare('UPDATE external_business_payroll_monthly SET amount=?,notes=?,updated_at=? WHERE id=?').run(amount,notes,now,existing.id);else db.prepare('INSERT INTO external_business_payroll_monthly(id,company_id,external_business_id,payroll_month,amount,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id('extpay'),req.user.company_id,b.id,month,amount,notes,req.user.user_id,now,now);audit(req,{action:'accountant.external_business_payroll.saved',entityType:'external_business_payroll',entityId:existing?.id||b.id,details:{externalBusinessId:b.id,month,amount}});res.json({message:'External business monthly payroll saved.'});
});

router.get('/api/accountant/external-businesses/:id/transactions',requireAuth,(req,res)=>{
  if(!requireExternalRead(req,res))return;const b=db.prepare('SELECT id,name,is_active AS isActive FROM external_businesses WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);if(!b)return res.status(404).json({error:'External business not found.'});
  const month=validMonth(req.query.month),[defaultStart,defaultEnd]=monthRange(month);const start=validDate(req.query.start)?String(req.query.start):defaultStart,end=validDate(req.query.end)?String(req.query.end):defaultEnd;if(start>end)return res.status(400).json({error:'Choose a valid start and end date.'});const rows=db.prepare(`SELECT id,transaction_date AS transactionDate,transaction_type AS transactionType,category,description,amount,notes,shared_expense_line_id AS sharedExpenseLineId FROM external_business_transactions WHERE company_id=? AND external_business_id=? AND transaction_date BETWEEN ? AND ? ORDER BY transaction_date DESC,created_at DESC`).all(req.user.company_id,b.id,start,end);
  res.json({business:b,month,start,end,transactions:rows});
});
router.post('/api/accountant/external-businesses/:id/transactions',requireAuth,requirePermission('external_businesses.manage'),requireIdempotency,(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;const b=db.prepare('SELECT id FROM external_businesses WHERE id=? AND company_id=? AND is_active=1').get(req.params.id,req.user.company_id);if(!b)return res.status(404).json({error:'External business not found.'});
  const {transactionDate,transactionType,category,description,amount,notes,reportingMonth}=req.body||{};const value=Number(amount);const itemName=String(category||req.body?.expenseItem||'').trim();const detail=String(description||'').trim();if(!validMonth(reportingMonth)||!validDate(transactionDate)||String(transactionDate).slice(0,7)!==reportingMonth)return res.status(400).json({error:'The transaction date must fall within the selected reporting month.'});if(!['earning','expense'].includes(transactionType)||(transactionType==='expense'&&!itemName)||!Number.isFinite(value)||value<=0)return res.status(400).json({error:'Enter a valid transaction type, expense item when recording an expense, and positive amount.'});
  const storedName=transactionType==='expense'?itemName:'Income';const txId=id('exttxn');db.prepare('INSERT INTO external_business_transactions(id,company_id,external_business_id,transaction_date,transaction_type,category,description,amount,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(txId,req.user.company_id,b.id,transactionDate,transactionType,storedName,detail||storedName,value,String(notes||'').trim()||null,req.user.user_id,nowIso());audit(req,{action:'accountant.external_business_transaction.created',entityType:'external_business_transaction',entityId:txId,details:{externalBusinessId:b.id,transactionDate,transactionType,amount:value}});res.status(201).json({id:txId,message:'External business transaction recorded.'});
});

router.put('/api/accountant/external-businesses/:id/transactions/:transactionId',requireAuth,requirePermission('external_businesses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;
  const current=db.prepare(`SELECT id,transaction_date AS transactionDate,transaction_type AS transactionType,category,description,amount,notes,shared_expense_line_id AS sharedExpenseLineId FROM external_business_transactions WHERE id=? AND external_business_id=? AND company_id=?`).get(req.params.transactionId,req.params.id,req.user.company_id);
  if(!current)return res.status(404).json({error:'Transaction not found for this external business.'});
  if(current.sharedExpenseLineId)return res.status(409).json({error:'This transaction is linked to a shared-expense allocation. Edit the original shared expense instead.'});
  const {transactionDate,transactionType,category,description,amount,notes,reportingMonth}=req.body||{};
  const value=Number(amount),itemName=String(category||req.body?.expenseItem||'').trim(),detail=String(description||'').trim();
  if(!validMonth(reportingMonth)||!validDate(transactionDate)||String(transactionDate).slice(0,7)!==reportingMonth)return res.status(400).json({error:'The transaction date must fall within the selected reporting month.'});
  if(!['earning','expense'].includes(transactionType)||(transactionType==='expense'&&!itemName)||!Number.isFinite(value)||value<=0)return res.status(400).json({error:'Enter a valid transaction type, expense item when recording an expense, and positive amount.'});
  const storedName=transactionType==='expense'?itemName:'Income';
  db.transaction(()=>{
    db.prepare(`UPDATE external_business_transactions SET transaction_date=?,transaction_type=?,category=?,description=?,amount=?,notes=? WHERE id=? AND external_business_id=? AND company_id=?`).run(transactionDate,transactionType,storedName,detail||storedName,value,String(notes||'').trim()||null,current.id,req.params.id,req.user.company_id);
    audit(req,{action:'accountant.external_business_transaction.updated',entityType:'external_business_transaction',entityId:current.id,details:{externalBusinessId:req.params.id,before:{transactionDate:current.transactionDate,transactionType:current.transactionType,category:current.category,description:current.description,amount:current.amount,notes:current.notes},after:{transactionDate,transactionType,category:storedName,description:detail||storedName,amount:value,notes:String(notes||'').trim()||null}}});
  })();
  res.json({message:'External business transaction updated.'});
});

router.delete('/api/accountant/external-businesses/:id/transactions/:transactionId',requireAuth,requirePermission('external_businesses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;
  const current=db.prepare(`SELECT id,transaction_date AS transactionDate,transaction_type AS transactionType,category,description,amount,notes,shared_expense_line_id AS sharedExpenseLineId FROM external_business_transactions WHERE id=? AND external_business_id=? AND company_id=?`).get(req.params.transactionId,req.params.id,req.user.company_id);
  if(!current)return res.status(404).json({error:'Transaction not found for this external business.'});
  if(current.sharedExpenseLineId)return res.status(409).json({error:'This transaction is linked to a shared-expense allocation. Delete or correct the original shared expense instead.'});
  db.transaction(()=>{
    db.prepare('DELETE FROM external_business_transactions WHERE id=? AND external_business_id=? AND company_id=?').run(current.id,req.params.id,req.user.company_id);
    audit(req,{action:'accountant.external_business_transaction.deleted',entityType:'external_business_transaction',entityId:current.id,details:{externalBusinessId:req.params.id,transactionDate:current.transactionDate,transactionType:current.transactionType,category:current.category,description:current.description,amount:current.amount,notes:current.notes,permanent:true}});
  })();
  res.json({message:'External business transaction permanently deleted.'});
});
router.get('/api/accountant/shared-expense-templates',requireAuth,(req,res)=>{
  if(!requireSharedRead(req,res,'shared_expenses.view'))return;const rows=db.prepare('SELECT id,name,description,created_at AS createdAt FROM shared_expense_templates WHERE company_id=? AND is_active=1 ORDER BY name').all(req.user.company_id);
  const lines=db.prepare('SELECT id,template_id AS templateId,business_type AS businessType,business_id AS businessId,percentage FROM shared_expense_template_lines WHERE template_id IN (SELECT id FROM shared_expense_templates WHERE company_id=? AND is_active=1)').all(req.user.company_id);
  const businesses=allocationBusinessList(req.user.company_id,assignedBusinessIds(req));const byId=new Map(businesses.map(b=>[`${b.businessType}:${b.id}`,b]));res.json({templates:rows.map(t=>({...t,lines:lines.filter(l=>l.templateId===t.id).map(l=>({...l,businessName:byId.get(`${l.businessType}:${l.businessId}`)?.name||'Archived business'}))}))});
});
router.post('/api/accountant/shared-expense-templates',requireAuth,requirePermission('shared_expenses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;const name=String(req.body?.name||'').trim(),description=String(req.body?.description||'').trim()||null,lines=Array.isArray(req.body?.lines)?req.body.lines:[];if(!name)return res.status(400).json({error:'Template name is required.'});if(!lines.length)return res.status(400).json({error:'Add at least one business to the template.'});
  if(db.prepare('SELECT id FROM shared_expense_templates WHERE company_id=? AND lower(name)=lower(?) AND is_active=1').get(req.user.company_id,name))return res.status(409).json({error:'A shared expense template with that name already exists.'});
  const allowed=allocationBusinessList(req.user.company_id,assignedBusinessIds(req));const normalized=[];let total=0;for(const line of lines){const type=String(line.businessType||''),businessId=String(line.businessId||''),pct=Number(line.percentage);const b=allowed.find(x=>x.businessType===type&&x.id===businessId);if(!b||!Number.isFinite(pct)||pct<0||pct>100)return res.status(400).json({error:'One or more selected businesses or percentages are invalid.'});if(normalized.some(x=>x.businessType===type&&x.businessId===businessId))return res.status(400).json({error:'A business can appear only once in a template.'});normalized.push({...b,percentage:pct});total+=pct;}if(Math.abs(total-100)>0.0001)return res.status(400).json({error:`Allocation must total 100%. Current total: ${total.toFixed(2)}%.`});
  const templateId=id('shxt'),now=nowIso();db.transaction(()=>{db.prepare('INSERT INTO shared_expense_templates(id,company_id,name,description,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(templateId,req.user.company_id,name,description,req.user.user_id,now,now);const insert=db.prepare('INSERT INTO shared_expense_template_lines(id,template_id,business_type,business_id,percentage,created_at) VALUES(?,?,?,?,?,?)');for(const line of normalized)insert.run(id('shxl'),templateId,line.businessType,line.id,line.percentage,now);})();audit(req,{action:'accountant.shared_expense_template.created',entityType:'shared_expense_template',entityId:templateId,details:{name,lines:normalized.length,totalPercentage:total}});res.status(201).json({id:templateId,message:'Shared expense template created.'});
});
router.put('/api/accountant/shared-expense-templates/:id',requireAuth,requirePermission('shared_expenses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;const templateId=req.params.id,name=String(req.body?.name||'').trim(),description=String(req.body?.description||'').trim()||null,lines=Array.isArray(req.body?.lines)?req.body.lines:[];const current=db.prepare('SELECT id,name FROM shared_expense_templates WHERE id=? AND company_id=? AND is_active=1').get(templateId,req.user.company_id);if(!current)return res.status(404).json({error:'Shared expense template not found.'});if(!name||!lines.length)return res.status(400).json({error:'Template name and business allocations are required.'});if(db.prepare('SELECT id FROM shared_expense_templates WHERE company_id=? AND lower(name)=lower(?) AND id<>? AND is_active=1').get(req.user.company_id,name,templateId))return res.status(409).json({error:'Another template already uses that name.'});
  const allowed=allocationBusinessList(req.user.company_id,assignedBusinessIds(req)),normalized=[];let total=0;for(const line of lines){const type=String(line.businessType||''),businessId=String(line.businessId||''),pct=Number(line.percentage),b=allowed.find(x=>x.businessType===type&&x.id===businessId);if(!b||!Number.isFinite(pct)||pct<0||pct>100)return res.status(400).json({error:'Invalid business or percentage.'});if(normalized.some(x=>x.businessType===type&&x.id===businessId))return res.status(400).json({error:'Duplicate business in template.'});normalized.push({...b,percentage:pct});total+=pct;}if(Math.abs(total-100)>0.0001)return res.status(400).json({error:`Allocation must total 100%. Current total: ${total.toFixed(2)}%.`});const now=nowIso();db.transaction(()=>{db.prepare('UPDATE shared_expense_templates SET name=?,description=?,updated_at=? WHERE id=? AND company_id=?').run(name,description,now,templateId,req.user.company_id);db.prepare('DELETE FROM shared_expense_template_lines WHERE template_id=?').run(templateId);const ins=db.prepare('INSERT INTO shared_expense_template_lines(id,template_id,business_type,business_id,percentage,created_at) VALUES(?,?,?,?,?,?)');for(const line of normalized)ins.run(id('shxl'),templateId,line.businessType,line.id,line.percentage,now);})();audit(req,{action:'accountant.shared_expense_template.updated',entityType:'shared_expense_template',entityId:templateId,details:{before:current,after:{name,lines:normalized.length,totalPercentage:total}}});res.json({message:'Template updated. Previously recorded allocations remain unchanged.'});
});
router.delete('/api/accountant/shared-expense-templates/:id',requireAuth,requirePermission('shared_expenses.manage'),(req,res)=>{if(!requireAccountantWorkspace(req,res))return;const t=db.prepare('SELECT id,name FROM shared_expense_templates WHERE id=? AND company_id=? AND is_active=1').get(req.params.id,req.user.company_id);if(!t)return res.status(404).json({error:'Template not found.'});db.prepare('UPDATE shared_expense_templates SET is_active=0,updated_at=? WHERE id=? AND company_id=?').run(nowIso(),t.id,req.user.company_id);audit(req,{action:'accountant.shared_expense_template.archived',entityType:'shared_expense_template',entityId:t.id,details:{name:t.name}});res.json({message:'Template archived. Historical allocations are preserved.'});});
router.get('/api/accountant/shared-expenses',requireAuth,(req,res)=>{if(!requireSharedRead(req,res,'shared_expenses.view'))return;const month=validMonth(req.query.month),[start,end]=monthRange(month);const rows=db.prepare(`SELECT s.id,s.template_id AS templateId,s.template_name AS templateName,s.expense_date AS expenseDate,s.expense_period AS expensePeriod,s.total_amount AS totalAmount,s.reference,s.notes,s.status,s.created_at AS createdAt,COALESCE(SUM(l.amount),0) AS allocatedAmount,COUNT(l.id) AS businessCount FROM shared_expenses s LEFT JOIN shared_expense_lines l ON l.shared_expense_id=s.id WHERE s.company_id=? AND s.expense_date BETWEEN ? AND ? GROUP BY s.id ORDER BY s.expense_date DESC,s.created_at DESC`).all(req.user.company_id,start,end);res.json({month,expenses:rows});});
router.get('/api/accountant/shared-expenses/:id',requireAuth,(req,res)=>{if(!requireSharedRead(req,res,'shared_expenses.view'))return;const expense=db.prepare('SELECT id,template_name AS templateName,expense_date AS expenseDate,expense_period AS expensePeriod,total_amount AS totalAmount,reference,notes,status,created_at AS createdAt,updated_at AS updatedAt FROM shared_expenses WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);if(!expense)return res.status(404).json({error:'Shared expense not found.'});const lines=db.prepare('SELECT business_type AS businessType,business_id AS businessId,business_name AS businessName,percentage,amount FROM shared_expense_lines WHERE shared_expense_id=? ORDER BY created_at,id').all(expense.id);res.json({expense,lines});});
router.post('/api/accountant/shared-expenses',requireAuth,requirePermission('shared_expenses.manage'),requireIdempotency,(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;const {templateId,expenseDate,expensePeriod,totalAmount,reference,notes,percentages}=req.body||{};const value=Number(totalAmount);if(!validDate(expenseDate)||!/^\d{4}-\d{2}$/.test(String(expensePeriod||''))||String(expenseDate).slice(0,7)!==String(expensePeriod)||!Number.isFinite(value)||value<=0)return res.status(400).json({error:'Expense date must fall within the selected expense period, with a positive total amount.'});
  const template=db.prepare('SELECT id,name FROM shared_expense_templates WHERE id=? AND company_id=? AND is_active=1').get(templateId,req.user.company_id);if(!template)return res.status(400).json({error:'Select a valid shared expense template.'});const source=db.prepare('SELECT business_type AS businessType,business_id AS businessId,percentage FROM shared_expense_template_lines WHERE template_id=?').all(template.id);if(!source.length)return res.status(400).json({error:'This template has no business allocations.'});const pctOverrides=percentages&&typeof percentages==='object'?percentages:{};const allowed=allocationBusinessList(req.user.company_id,assignedBusinessIds(req));const lines=[];let pctTotal=0;for(const row of source){const business=allowed.find(b=>b.businessType===row.businessType&&b.id===row.businessId);if(!business)return res.status(400).json({error:'A business in this template is no longer available. Edit the template first.'});const pct=Object.prototype.hasOwnProperty.call(pctOverrides,`${row.businessType}:${row.businessId}`)?Number(pctOverrides[`${row.businessType}:${row.businessId}`]):Number(row.percentage);if(!Number.isFinite(pct)||pct<0||pct>100)return res.status(400).json({error:'Invalid percentage override.'});lines.push({...row,businessName:business.name,percentage:pct});pctTotal+=pct;}if(Math.abs(pctTotal-100)>0.0001)return res.status(400).json({error:`This expense must allocate 100%. Current total: ${pctTotal.toFixed(2)}%.`});
  const amounts=lines.map(l=>Math.round(value*l.percentage)/100),sum=amounts.reduce((a,b)=>a+b,0);const rounded= Math.round((value-sum)*100);for(let i=0;rounded!==0&&i<Math.abs(rounded);i++)amounts[i%amounts.length]+=Math.sign(rounded)*0.01;
  const sharedId=id('shxp'),now=nowIso();db.transaction(()=>{db.prepare(`INSERT INTO shared_expenses(id,company_id,template_id,template_name,expense_date,expense_period,total_amount,reference,notes,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'posted',?,?,?)`).run(sharedId,req.user.company_id,template.id,template.name,expenseDate,expensePeriod,value,String(reference||'').trim()||null,String(notes||'').trim()||null,req.user.user_id,now,now);const insLine=db.prepare('INSERT INTO shared_expense_lines(id,shared_expense_id,company_id,business_type,business_id,business_name,percentage,amount,created_at) VALUES(?,?,?,?,?,?,?,?,?)');const insLinked=db.prepare('INSERT INTO accountant_expenses(id,company_id,business_id,expense_date,category,description,amount,notes,created_by,created_at,shared_expense_id,shared_expense_line_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');const insExternal=db.prepare(`INSERT INTO external_business_transactions(id,company_id,external_business_id,transaction_date,transaction_type,category,description,amount,notes,shared_expense_line_id,created_by,created_at) VALUES(?,?,?,?,'expense',?,?,?,?,?,?,?)`);lines.forEach((l,i)=>{const lineId=id('shxl');let expenseId=null;const amount=Math.round(amounts[i]*100)/100;insLine.run(lineId,sharedId,req.user.company_id,l.businessType,l.businessId,l.businessName,l.percentage,amount,now);if(l.businessType==='linked'){expenseId=id('exp');insLinked.run(expenseId,req.user.company_id,l.businessId,expenseDate,template.name,`${template.name} (Shared allocation)`,amount,`Shared expense allocation ${sharedId}${reference?' · Ref '+String(reference).trim():''}`,req.user.user_id,now,sharedId,lineId);db.prepare('UPDATE shared_expense_lines SET accountant_expense_id=? WHERE id=?').run(expenseId,lineId);}else{insExternal.run(id('exttxn'),req.user.company_id,l.businessId,expenseDate,template.name,`${template.name} (Shared allocation)`,amount,`Shared expense allocation ${sharedId}${reference?' · Ref '+String(reference).trim():''}`,lineId,req.user.user_id,now);}});audit(req,{action:'accountant.shared_expense.created',entityType:'shared_expense',entityId:sharedId,details:{templateId:template.id,templateName:template.name,expenseDate,expensePeriod,totalAmount:value,lineCount:lines.length,totalPercentage:pctTotal}});});res.status(201).json({id:sharedId,message:'Shared expense allocated to all selected businesses.'});
});
router.put('/api/accountant/shared-expenses/:id',requireAuth,requirePermission('shared_expenses.manage'),(req,res)=>{
  if(!requireAccountantWorkspace(req,res))return;const current=db.prepare("SELECT * FROM shared_expenses WHERE id=? AND company_id=? AND status='posted'").get(req.params.id,req.user.company_id);if(!current)return res.status(404).json({error:'Posted shared expense not found.'});const value=Number(req.body?.totalAmount),expenseDate=String(req.body?.expenseDate||current.expense_date),expensePeriod=String(req.body?.expensePeriod||current.expense_period),reference=String(req.body?.reference||'').trim()||null,notes=String(req.body?.notes||'').trim()||null;if(!Number.isFinite(value)||value<=0||!validDate(expenseDate)||!/^\d{4}-\d{2}$/.test(expensePeriod)||expenseDate.slice(0,7)!==expensePeriod)return res.status(400).json({error:'Expense date must fall within the selected expense period, with a positive amount.'});
  const lines=db.prepare('SELECT *,business_type AS businessType,business_id AS businessId,accountant_expense_id AS accountantExpenseId FROM shared_expense_lines WHERE shared_expense_id=? ORDER BY created_at,id').all(current.id);const pctTotal=lines.reduce((n,l)=>n+Number(l.percentage),0);if(Math.abs(pctTotal-100)>0.0001)return res.status(400).json({error:'Saved allocation percentages do not total 100%; cannot safely update.'});const amounts=lines.map(l=>Math.round(value*Number(l.percentage))/100);const diff=Math.round((value-amounts.reduce((a,b)=>a+b,0))*100);for(let i=0;diff!==0&&i<Math.abs(diff);i++)amounts[i%amounts.length]+=Math.sign(diff)*0.01;const now=nowIso();db.transaction(()=>{db.prepare('UPDATE shared_expenses SET expense_date=?,expense_period=?,total_amount=?,reference=?,notes=?,updated_at=? WHERE id=?').run(expenseDate,expensePeriod,value,reference,notes,now,current.id);lines.forEach((l,i)=>{const amount=Math.round(amounts[i]*100)/100;db.prepare('UPDATE shared_expense_lines SET amount=? WHERE id=?').run(amount,l.id);if(l.businessType==='linked'){db.prepare('UPDATE accountant_expenses SET expense_date=?,amount=?,notes=? WHERE id=? AND shared_expense_line_id=?').run(expenseDate,amount,`Shared expense allocation ${current.id}${reference?' · Ref '+reference:''}`,l.accountantExpenseId,l.id);}else{db.prepare('UPDATE external_business_transactions SET transaction_date=?,amount=?,notes=? WHERE company_id=? AND shared_expense_line_id=?').run(expenseDate,amount,`Shared expense allocation ${current.id}${reference?' · Ref '+reference:''}`,req.user.company_id,l.id);}});audit(req,{action:'accountant.shared_expense.updated',entityType:'shared_expense',entityId:current.id,details:{before:{expenseDate:current.expense_date,expensePeriod:current.expense_period,totalAmount:current.total_amount},after:{expenseDate,expensePeriod,totalAmount:value}}});})();res.json({message:'Shared expense updated and all business expense records reconciled.'});
});
router.delete('/api/accountant/shared-expenses/:id',requireAuth,requirePermission('shared_expenses.manage'),(req,res)=>{if(!requireAccountantWorkspace(req,res))return;const current=db.prepare("SELECT id,total_amount,template_name FROM shared_expenses WHERE id=? AND company_id=? AND status='posted'").get(req.params.id,req.user.company_id);if(!current)return res.status(404).json({error:'Posted shared expense not found.'});const lines=db.prepare('SELECT *,business_type AS businessType,business_id AS businessId,accountant_expense_id AS accountantExpenseId FROM shared_expense_lines WHERE shared_expense_id=?').all(current.id);db.transaction(()=>{for(const l of lines){if(l.businessType==='linked')db.prepare('DELETE FROM accountant_expenses WHERE id=? AND shared_expense_line_id=?').run(l.accountantExpenseId,l.id);else db.prepare('DELETE FROM external_business_transactions WHERE company_id=? AND shared_expense_line_id=?').run(req.user.company_id,l.id);}db.prepare("UPDATE shared_expenses SET status='cancelled',updated_at=? WHERE id=? AND company_id=?").run(nowIso(),current.id,req.user.company_id);audit(req,{action:'accountant.shared_expense.cancelled',entityType:'shared_expense',entityId:current.id,details:{templateName:current.template_name,totalAmount:current.total_amount,removedGeneratedLines:lines.length}});})();res.json({message:'Shared expense cancelled. Its generated entries were removed from active totals; the allocation history was preserved.'});});

module.exports = router;
