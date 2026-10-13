const express = require('express');
const { db } = require('../database/database');
const { requireAuth, requirePermission } = require('../auth/middleware');
const { hasPermission } = require('../permissions');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { audit } = require('../audit/auditService');
const { requireIdempotency } = require('../security/idempotency');

const router = express.Router();
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
  const rows = db.prepare(`SELECT e.id,e.business_id AS businessId,b.name AS businessName,e.expense_date AS expenseDate,e.category,e.description,e.amount,e.notes,e.created_at AS createdAt FROM accountant_expenses e JOIN businesses b ON b.id=e.business_id WHERE b.company_id=? AND e.company_id=? AND e.expense_date BETWEEN ? AND ? AND e.business_id IN (${placeholders})${filter} ORDER BY e.expense_date DESC,e.created_at DESC`).all(...params);
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
      e.category,e.description,e.amount,e.notes,e.created_at AS createdAt
    FROM accountant_expenses e
    JOIN businesses b ON b.id=e.business_id
    WHERE e.company_id=? AND e.expense_date BETWEEN ? AND ? AND e.business_id IN (${placeholders})
    ORDER BY e.expense_date DESC,e.created_at DESC
  `).all(req.user.company_id, monthStart, monthEnd, ...ids);
  res.json({ month, start:monthStart, end:monthEnd, expenses: rows });
});

router.get('/api/owner/expenses', requireAuth, (req, res) => {
  if (!companyWide.includes(String(req.user.role || '').toLowerCase())) return res.status(403).json({ error: 'Owner access required.' });
  const month = validMonth(req.query.month);
  const range=selectedRange(req,month);if(!range)return res.status(400).json({error:'Choose a valid start and end date.'});const [monthStart, monthEnd] = range;
  const rows = db.prepare(`
    SELECT e.id,e.business_id AS businessId,b.name AS businessName,e.expense_date AS expenseDate,
      e.category,e.description,e.amount,e.notes,e.created_by AS createdBy,e.created_at AS createdAt
    FROM accountant_expenses e
    JOIN businesses b ON b.id=e.business_id
    WHERE e.company_id=? AND e.expense_date BETWEEN ? AND ?
    ORDER BY e.expense_date DESC,e.created_at DESC
  `).all(req.user.company_id, monthStart, monthEnd);
  res.json({ month, start:monthStart, end:monthEnd, expenses: rows });
});

router.get('/api/owner/expense-summary', requireAuth, (req, res) => {
  if (!companyWide.includes(String(req.user.role || '').toLowerCase())) return res.status(403).json({ error: 'Owner access required.' });
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
  const current=db.prepare(`SELECT id,business_id AS businessId,expense_date AS expenseDate,category,amount FROM accountant_expenses WHERE id=? AND company_id=? AND business_id IN (${placeholders})`).get(req.params.id,req.user.company_id,...ids);
  if (!current) return res.status(404).json({ error: 'Expense not found in your assigned businesses.' });
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

module.exports = router;
