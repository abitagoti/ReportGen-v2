const express = require('express');
const { z } = require('zod');
const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { audit } = require('../audit/auditService');
const { requireAuth, requirePermission } = require('../auth/middleware');
const { hasPermission } = require('../permissions');

const router = express.Router();

const businessSchema = z.object({
  name: z.string().trim().min(2).max(150),
  type: z.string().trim().min(2).max(80).default('business'),
  currency: z.string().trim().min(3).max(6).default('NGN')
});

router.get('/api/businesses', requireAuth, (req, res) => {
  let rows;

  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0,7);
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const start = validDate(req.query.start) ? String(req.query.start) : `${month}-01`;
  const end = validDate(req.query.end) ? String(req.query.end) : `${month}-${String(new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).getUTCDate()).padStart(2,'0')}`;
  const select = `WITH sales_by_business AS (
      SELECT t.business_id,
             COALESCE(SUM(t.sales_amount),0) AS monthlySales,
             COUNT(*) AS transactions
      FROM sales_transactions t
      WHERE t.company_id=? AND t.transaction_date BETWEEN ? AND ?
      GROUP BY t.business_id
    )
    SELECT b.id, b.name, b.type, b.currency, b.is_active AS isActive,
      COALESCE(s.monthlySales,0) AS monthlySales,
      COALESCE(s.transactions,0) AS transactions,
      (SELECT COUNT(*) FROM user_business_access a WHERE a.business_id=b.id) AS managerCount,
      (SELECT COUNT(*) FROM payroll_employees e WHERE e.business_id=b.id) AS staffCount
    FROM businesses b
    LEFT JOIN sales_by_business s ON s.business_id=b.id
    WHERE b.company_id=?`;
  if (['owner', 'general_manager', 'administrator', 'admin'].includes(String(req.user.role||'').toLowerCase())) {
    rows = db.prepare(`${select} ORDER BY b.name`).all(req.user.company_id,start,end,req.user.company_id);
  } else {
    rows = db.prepare(`${select} AND EXISTS (SELECT 1 FROM user_business_access a2 WHERE a2.business_id=b.id AND a2.user_id=?) ORDER BY b.name`).all(req.user.company_id,start,end,req.user.company_id,req.user.user_id);
  }

  res.json({ month, businesses: rows });
});

router.post('/api/businesses', requireAuth, requirePermission('businesses.manage'), (req, res) => {
  const parsed = businessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid business.' });

  const businessId = id('biz');
  const now = nowIso();

  db.prepare(`
    INSERT INTO businesses (id, company_id, name, type, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    businessId,
    req.user.company_id,
    parsed.data.name,
    parsed.data.type,
    parsed.data.currency,
    now,
    now
  );

  audit(req, {
    action: 'business.created',
    entityType: 'business',
    entityId: businessId,
    businessId: businessId,
    details: { name: parsed.data.name }
  });

  res.status(201).json({ business: { id: businessId, ...parsed.data } });
});


router.patch('/api/businesses/:businessId', requireAuth, requirePermission('businesses.manage'), (req, res) => {
  const parsed = businessSchema.partial().extend({ isActive: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid business update.' });

  const existing = db.prepare(`SELECT id, name, type, currency, is_active AS isActive FROM businesses WHERE id = ? AND company_id = ?`).get(req.params.businessId, req.user.company_id);
  if (!existing) return res.status(404).json({ error: 'Business not found.' });

  const next = {
    name: parsed.data.name ?? existing.name,
    type: parsed.data.type ?? existing.type,
    currency: parsed.data.currency ?? existing.currency,
    isActive: parsed.data.isActive === undefined ? Number(existing.isActive) : (parsed.data.isActive ? 1 : 0)
  };
  const now = nowIso();
  try {
    db.prepare(`UPDATE businesses SET name = ?, type = ?, currency = ?, is_active = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(next.name, next.type, next.currency, next.isActive, now, req.params.businessId, req.user.company_id);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'A business with that name already exists.' });
    throw error;
  }

  audit(req, {
    action: 'business.updated',
    entityType: 'business',
    entityId: req.params.businessId,
    businessId: req.params.businessId,
    details: next
  });
  res.json({ business: { id: req.params.businessId, ...next } });
});

router.get('/api/businesses/:businessId/details', requireAuth, (req, res, next) => {
  // Businesses, Company Comparison and Reports all read this per-business feed.
  if (['businesses.view', 'comparison.view', 'reports.view'].some(p => hasPermission(req, p))) return next();
  return res.status(403).json({ error: 'You do not have permission for this action.' });
}, (req, res) => {
  const business = db.prepare(`SELECT id,name,type,currency,is_active AS isActive,created_at AS createdAt,updated_at AS updatedAt FROM businesses WHERE id=? AND company_id=?`).get(req.params.businessId, req.user.company_id);
  if (!business) return res.status(404).json({ error: 'Business not found.' });
  const role = String(req.user.role || '').toLowerCase();
  const companyWide = ['owner','general_manager','administrator','admin'].includes(role);
  if (!companyWide) {
    const allowed = db.prepare('SELECT 1 FROM user_business_access WHERE user_id=? AND business_id=?').get(req.user.user_id, business.id);
    if (!allowed) return res.status(403).json({ error: 'You do not have access to this business.' });
  }
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0,7);
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const start = validDate(req.query.start) ? String(req.query.start) : `${month}-01`;
  const end = validDate(req.query.end) ? String(req.query.end) : `${month}-${String(new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).getUTCDate()).padStart(2,'0')}`;
  const summary = db.prepare(`SELECT COALESCE(SUM(sales_amount),0) AS sales,COALESCE(SUM(gross_amount),0) AS gross,COALESCE(SUM(returns_amount),0) AS returns,COALESCE(SUM(profit_amount),0) AS importedProfit,COUNT(*) AS transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ?`).get(req.user.company_id,business.id,start,end);
  const managers = db.prepare(`SELECT u.id,u.username,u.display_name AS displayName,u.role FROM users u JOIN user_business_access a ON a.user_id=u.id WHERE u.company_id=? AND a.business_id=? ORDER BY u.display_name`).all(req.user.company_id,business.id);
  const staff = db.prepare(`SELECT id,employee_code AS employeeCode,employee_name AS employeeName,role_title AS roleTitle,is_active AS isActive FROM payroll_employees WHERE company_id=? AND business_id=? ORDER BY employee_name`).all(req.user.company_id,business.id);
  const year = month.slice(0,4);
  const monthlyTrend = db.prepare(`SELECT substr(transaction_date,1,7) AS month,COALESCE(SUM(sales_amount),0) AS sales,COALESCE(SUM(gross_amount),0) AS gross,COALESCE(SUM(returns_amount),0) AS returns,COALESCE(SUM(cost_amount),0) AS cost,COALESCE(SUM(profit_amount),0) AS importedProfit,COUNT(*) AS transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY substr(transaction_date,1,7) ORDER BY month ASC`).all(req.user.company_id,business.id,`${year}-01-01`,`${year}-12-31`);
  const topProducts = db.prepare(`SELECT COALESCE(product_name,'Unspecified') AS productName,COALESCE(SUM(sales_amount),0) AS sales,COALESCE(SUM(quantity),0) AS quantity,COUNT(*) AS transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY product_name ORDER BY sales DESC LIMIT 10`).all(req.user.company_id,business.id,start,end);
  const topProfitable = db.prepare(`SELECT COALESCE(product_name,'Unspecified') AS productName,COALESCE(SUM(profit_amount),0) AS profit,COALESCE(SUM(sales_amount),0) AS sales FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY product_name ORDER BY profit DESC LIMIT 10`).all(req.user.company_id,business.id,start,end);
  const topStaff = db.prepare(`SELECT COALESCE(NULLIF(TRIM(salesperson),''),'Unassigned') AS salesperson,COALESCE(SUM(sales_amount),0) AS sales,COUNT(*) AS transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY salesperson ORDER BY sales DESC LIMIT 10`).all(req.user.company_id,business.id,start,end);
  const dailyTrend = db.prepare(`SELECT transaction_date AS day,COALESCE(SUM(sales_amount),0) AS sales,COALESCE(SUM(cost_amount),0) AS cost,COALESCE(SUM(profit_amount),0) AS importedProfit,COUNT(*) AS transactions FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY transaction_date ORDER BY transaction_date`).all(req.user.company_id,business.id,start,end);
  const categories = db.prepare(`SELECT COALESCE(category,'Uncategorized') AS category,COALESCE(SUM(sales_amount),0) AS sales FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ? GROUP BY category ORDER BY sales DESC`).all(req.user.company_id,business.id,start,end);
  const expenseTotal = db.prepare(`SELECT COALESCE(SUM(amount),0) AS amount FROM accountant_expenses WHERE company_id=? AND business_id=? AND expense_date BETWEEN ? AND ?`).get(req.user.company_id,business.id,start,end);
  const capitalTotal = db.prepare(`SELECT COALESCE(SUM(amount),0) AS amount FROM capital_contributions WHERE company_id=? AND business_id=? AND period_start<=? AND period_end>=?`).get(req.user.company_id,business.id, end, start);
  const importCount = db.prepare('SELECT COUNT(*) AS count FROM sales_imports WHERE company_id=? AND business_id=?').get(req.user.company_id,business.id);
  const costTotal = db.prepare(`SELECT COALESCE(SUM(cost_amount),0) AS amount FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ?`).get(req.user.company_id,business.id,start,end);
  const startPayrollMonth = start.slice(0,7);
  const endPayrollMonth = end.slice(0,7);
  const payrollManual = db.prepare(`SELECT COALESCE(SUM(amount),0) AS amount FROM payroll_monthly_totals WHERE company_id=? AND business_id=? AND payroll_month BETWEEN ? AND ? AND calculation_mode='manual' AND status='saved'`).get(req.user.company_id,business.id,startPayrollMonth,endPayrollMonth);
  const payrollEmployees = db.prepare(`SELECT COALESCE(SUM(pe.gross_amount),0) AS amount FROM payroll_entries pe WHERE pe.company_id=? AND pe.business_id=? AND pe.payroll_month BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM payroll_monthly_totals pm WHERE pm.company_id=pe.company_id AND pm.business_id=pe.business_id AND pm.payroll_month=pe.payroll_month AND pm.calculation_mode='employees' AND pm.status='saved')`).get(req.user.company_id,business.id,startPayrollMonth,endPayrollMonth);
  const payrollAmount = Number(payrollManual?.amount||0) + Number(payrollEmployees?.amount||0);
  const expenses = db.prepare(`SELECT id,expense_date AS expenseDate,category,description,amount FROM accountant_expenses WHERE company_id=? AND business_id=? AND expense_date BETWEEN ? AND ? ORDER BY expense_date DESC,created_at DESC`).all(req.user.company_id,business.id,start,end);
  const expenseAmount = Number(expenseTotal?.amount||0);
  const costAmount = Number(costTotal?.amount||0);
  const grossProfit = Number(summary.sales||0)-costAmount;
  const totalExpenses = expenseAmount + payrollAmount;
  const netProfit = grossProfit-totalExpenses;
  const daily = dailyTrend.map(x=>({day:x.day,sales:Number(x.sales||0),cost:Number(x.cost||0),grossProfit:Number(x.sales||0)-Number(x.cost||0),importedProfit:Number(x.importedProfit||0),transactions:Number(x.transactions||0)}));
  const highestSalesDay = daily.slice().sort((a,b)=>b.sales-a.sales)[0]||null;
  const lowestSalesDay = daily.slice().sort((a,b)=>a.sales-b.sales)[0]||null;
  const customerFlow = {daysWithSales:daily.length,averageSale:Number(summary.transactions||0)>0?Number(summary.sales||0)/Number(summary.transactions||0):0,highestSalesDay,lowestSalesDay,daily};
  res.json({business,month,start,end,summary:{sales:Number(summary.sales||0),gross:Number(summary.gross||0),returns:Number(summary.returns||0),grossProfit,importedProfit:Number(summary.importedProfit||0),transactions:Number(summary.transactions||0)},financials:{costOfGoods:costAmount,grossProfit,expenses:expenseAmount,payroll:payrollAmount,totalExpenses,netProfit,purchases:Number(capitalTotal?.amount||0),averageSale:customerFlow.averageSale,returnRate:Number(summary.gross||0)>0?(Number(summary.returns||0)/Number(summary.gross||0))*100:0,topCategory:categories[0]?.category||'—'},managers,staff,monthlyTrend:monthlyTrend.map(x=>({...x,sales:Number(x.sales||0),gross:Number(x.gross||0),returns:Number(x.returns||0),cost:Number(x.cost||0),grossProfit:Number(x.sales||0)-Number(x.cost||0),importedProfit:Number(x.importedProfit||0),transactions:Number(x.transactions||0)})),topProducts:topProducts.map(x=>({...x,sales:Number(x.sales||0),quantity:Number(x.quantity||0),transactions:Number(x.transactions||0)})),topProfitable:topProfitable.map(x=>({...x,profit:Number(x.profit||0),sales:Number(x.sales||0)})),categories:categories.map(x=>({...x,sales:Number(x.sales||0)})),expenses:expenses.map(x=>({...x,amount:Number(x.amount||0)})),topStaff:topStaff.map(x=>({...x,sales:Number(x.sales||0),transactions:Number(x.transactions||0)})),customerFlow,importCount:Number(importCount?.count||0)});
});

module.exports = router;
