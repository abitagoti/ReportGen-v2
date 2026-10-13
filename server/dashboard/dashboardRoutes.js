const express = require('express');
const { z } = require('zod');
const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { requireAuth, requirePermission } = require('../auth/middleware');
const { audit } = require('../audit/auditService');
const router = express.Router();

const managementRoles = ['owner','general_manager','administrator','admin'];
const roleOf = req => String(req.user.role || '').toLowerCase();
const isManagement = req => managementRoles.includes(roleOf(req));

function monthRange(month) {
  const last = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2,'0')}`];
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [y,m,d] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d;
}
function validMonth(value) { return /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(String(value || '')); }
function selectedRange(req, month) {
  const [defaultStart, defaultEnd] = monthRange(month);
  const start = validDate(req.query.start) ? String(req.query.start) : defaultStart;
  const end = validDate(req.query.end) ? String(req.query.end) : defaultEnd;
  return start <= end ? [start, end] : null;
}
function businessIdsFor(req) {
  if (isManagement(req)) return db.prepare('SELECT id FROM businesses WHERE company_id=? AND is_active=1 ORDER BY name').all(req.user.company_id).map(x => x.id);
  return db.prepare(`SELECT b.id FROM businesses b JOIN user_business_access a ON a.business_id=b.id WHERE b.company_id=? AND b.is_active=1 AND a.user_id=? ORDER BY b.name`).all(req.user.company_id, req.user.user_id).map(x => x.id);
}
function canUseBusiness(req, businessId) { return businessIdsFor(req).includes(String(businessId)); }
function scopeSql(req, alias='t') {
  if (isManagement(req)) return { sql:'', params:[] };
  return { sql:` AND EXISTS (SELECT 1 FROM user_business_access uba WHERE uba.business_id=${alias}.business_id AND uba.user_id=?)`, params:[req.user.user_id] };
}
function selectedBusiness(req) {
  const raw = req.query.businessId == null ? '' : String(req.query.businessId).trim();
  if (!raw || raw === 'all') return null;
  if (!canUseBusiness(req, raw)) return '__invalid__';
  return raw;
}
function purchaseScope(req, businessId) {
  if (businessId) return { sql:' AND c.business_id=?', params:[businessId] };
  if (isManagement(req)) return { sql:'', params:[] };
  return { sql:' AND c.business_id IN (SELECT business_id FROM user_business_access WHERE user_id=?)', params:[req.user.user_id] };
}
function salesScope(req, businessId, alias='t') {
  if (businessId) return { sql:` AND ${alias}.business_id=?`, params:[businessId] };
  return scopeSql(req, alias);
}

router.get('/api/dashboard/summary', requireAuth, requirePermission('dashboard.view'), (req,res) => {
  const month = validMonth(req.query.month) ? String(req.query.month) : new Date().toISOString().slice(0,7);
  const range = selectedRange(req, month);
  if (!range) return res.status(400).json({error:'Choose a valid start and end date.'});
  const [start,end] = range;
  const businessId = selectedBusiness(req);
  if (businessId === '__invalid__') return res.status(403).json({error:'You do not have access to that business.'});
  const [monthStart,monthEnd] = monthRange(month);
  const fullMonth = start === monthStart && end === monthEnd;

  const salesScopeData = salesScope(req,businessId);
  const salesParams=[req.user.company_id,start,end,...salesScopeData.params];
  const sales = db.prepare(`SELECT COALESCE(SUM(t.sales_amount),0) AS sales, COALESCE(SUM(t.cost_amount),0) AS cost, COALESCE(SUM(t.gross_amount),0) AS gross, COALESCE(SUM(t.returns_amount),0) AS returns, COALESCE(SUM(t.profit_amount),0) AS importedProfit, COUNT(*) AS transactions, COUNT(DISTINCT t.business_id) AS activeBusinesses FROM sales_transactions t WHERE t.company_id=? AND t.transaction_date BETWEEN ? AND ?${salesScopeData.sql}`).get(...salesParams);
  const grossProfit = Number(sales.sales||0) - Number(sales.cost||0);

  const expenseScope = businessId ? ' AND e.business_id=?' : (isManagement(req) ? '' : ' AND e.business_id IN (SELECT business_id FROM user_business_access WHERE user_id=?)');
  const expenseParams=[req.user.company_id,start,end,...(businessId?[businessId]:isManagement(req)?[]:[req.user.user_id])];
  const expenses = db.prepare(`SELECT COALESCE(SUM(e.amount),0) AS total, COUNT(*) AS count FROM accountant_expenses e WHERE e.company_id=? AND e.expense_date BETWEEN ? AND ?${expenseScope}`).get(...expenseParams);

  const payrollScope = businessId ? ' AND p.business_id=?' : (isManagement(req) ? '' : ' AND p.business_id IN (SELECT business_id FROM user_business_access WHERE user_id=?)');
  // Payroll is a monthly figure: count the full saved payroll for every calendar month the selected range touches.
  const payrollParams=[req.user.company_id,start.slice(0,7),end.slice(0,7),...(businessId?[businessId]:isManagement(req)?[]:[req.user.user_id])];
  const payrollRows = db.prepare(`SELECT p.business_id AS businessId,p.calculation_mode AS calculationMode,p.amount,(SELECT COALESCE(SUM(pe.gross_amount),0) FROM payroll_entries pe WHERE pe.company_id=p.company_id AND pe.business_id=p.business_id AND pe.payroll_month=p.payroll_month) AS employeeGross FROM payroll_monthly_totals p WHERE p.company_id=? AND p.payroll_month BETWEEN ? AND ? AND p.status='saved'${payrollScope}`).all(...payrollParams);
  const payroll = payrollRows.reduce((sum,row)=>sum+(row.calculationMode==='employees'?Number(row.employeeGross||0):Number(row.amount||0)),0);

  const purchaseScopeData = purchaseScope(req,businessId);
  const purchaseParams=[req.user.company_id,end,start,...purchaseScopeData.params];
  const purchases = db.prepare(`SELECT COALESCE(SUM(c.amount),0) AS total,COUNT(*) AS count FROM capital_contributions c WHERE c.company_id=? AND c.period_start<=? AND c.period_end>=?${purchaseScopeData.sql}`).get(...purchaseParams);
  const currentPurchases=Number(purchases.total||0);

  const ownerOnly = roleOf(req) === 'owner';
  const ownerMonths=[];
  const rangeMonths=[];
  {
    const cursor=new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7))-1,1));
    const last=new Date(Date.UTC(Number(end.slice(0,4)),Number(end.slice(5,7))-1,1));
    while(cursor<=last){
      rangeMonths.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth()+1).padStart(2,'0')}`);
      cursor.setUTCMonth(cursor.getUTCMonth()+1);
    }
  }

  const ownerBusinessIds=ownerOnly ? (businessId?[businessId]:businessIdsFor(req)) : [];
  const ownerBusinessNames=ownerBusinessIds.length?Object.fromEntries(
    db.prepare(`SELECT id,name FROM businesses WHERE company_id=? AND id IN (${ownerBusinessIds.map(()=>'?').join(',')})`)
      .all(req.user.company_id,...ownerBusinessIds)
      .map(row=>[row.id,row.name])
  ):{};
  const ownerDefaultRows=rangeMonths.length?db.prepare(`SELECT month,percent FROM dashboard_owner_defaults WHERE company_id=? AND month BETWEEN ? AND ?`).all(req.user.company_id,rangeMonths[0],rangeMonths[rangeMonths.length-1]):[];
  const ownerDefaultsByMonth=Object.fromEntries(ownerDefaultRows.map(row=>[row.month,Number(row.percent||0)]));
  const ownerAdjustmentRows=ownerBusinessIds.length&&rangeMonths.length?db.prepare(`SELECT business_id AS businessId,month,percent,excluded FROM dashboard_owner_adjustments WHERE company_id=? AND month BETWEEN ? AND ? AND business_id IN (${ownerBusinessIds.map(()=>'?').join(',')})`).all(req.user.company_id,rangeMonths[0],rangeMonths[rangeMonths.length-1],...ownerBusinessIds):[];
  const ownerAdjustmentsByKey=Object.fromEntries(ownerAdjustmentRows.map(row=>[`${row.month}:${row.businessId}`,row]));
  const ownerGpRows=ownerBusinessIds.length?db.prepare(`SELECT substr(t.transaction_date,1,7) AS month,t.business_id AS businessId,COALESCE(SUM(t.sales_amount),0)-COALESCE(SUM(t.cost_amount),0) AS grossProfit FROM sales_transactions t WHERE t.company_id=? AND t.transaction_date BETWEEN ? AND ? AND t.business_id IN (${ownerBusinessIds.map(()=>'?').join(',')}) GROUP BY substr(t.transaction_date,1,7),t.business_id`).all(req.user.company_id,start,end,...ownerBusinessIds):[];
  const ownerGpByKey=Object.fromEntries(ownerGpRows.map(row=>[`${row.month}:${row.businessId}`,Number(row.grossProfit||0)]));

  for (const ownerMonth of rangeMonths) {
    const [ownerMonthStart,ownerMonthEnd]=monthRange(ownerMonth);
    const ownerStart=start>ownerMonthStart?start:ownerMonthStart;
    const ownerEnd=end<ownerMonthEnd?end:ownerMonthEnd;
    const defaultPercent=Number(ownerDefaultsByMonth[ownerMonth]||0);
    const businessAllocations=ownerBusinessIds.map(bid=>{
      const adjustment=ownerAdjustmentsByKey[`${ownerMonth}:${bid}`];
      const grossProfitForBusiness=Number(ownerGpByKey[`${ownerMonth}:${bid}`]||0);
      const excluded=!!adjustment?.excluded;
      const percent=excluded?0:Number(adjustment?.percent??defaultPercent);
      const ownerExpenseForBusiness=Math.max(0,grossProfitForBusiness)*percent/100;
      return {
        businessId:bid,
        businessName:ownerBusinessNames[bid]||'Business',
        grossProfit:grossProfitForBusiness,
        percent,
        excluded,
        source:excluded?'excluded':adjustment?'override':'default',
        ownerExpense:ownerExpenseForBusiness
      };
    });
    const monthGrossProfit=businessAllocations.reduce((sum,row)=>sum+row.grossProfit,0);
    const monthOwnerExpense=businessAllocations.reduce((sum,row)=>sum+row.ownerExpense,0);
    ownerMonths.push({month:ownerMonth,start:ownerStart,end:ownerEnd,defaultPercent,grossProfit:monthGrossProfit,ownerExpense:monthOwnerExpense,businesses:businessAllocations});
  }

  const ownerExpense=ownerMonths.reduce((sum,row)=>sum+row.ownerExpense,0);
  const singleOwnerMonth=ownerMonths.length===1?ownerMonths[0]:null;
  const ownerPercent=businessId?(singleOwnerMonth?.businesses[0]?.percent??0):Number(ownerMonths[0]?.defaultPercent||0);
  const defaultOwnerPercent=Number(ownerMonths[0]?.defaultPercent||0);
  const selectedExcluded=!!singleOwnerMonth?.businesses[0]?.excluded;
  const allocationRows=singleOwnerMonth?.businesses.map(row=>({businessId:row.businessId,businessName:row.businessName,percent:row.percent,excluded:row.excluded}))||[];

  const netProfit = grossProfit - Number(expenses.total||0) - payroll - ownerExpense;

  const businessScopeIds = businessIdsFor(req);
  let contributionRows=[];
  if (businessScopeIds.length) {
    const ph=businessScopeIds.map(()=>'?').join(',');
    const contributionFilter=businessId ? ' AND t.business_id=?' : '';
    const contributionParams=[req.user.company_id,start,end,...businessScopeIds,...(businessId?[businessId]:[])];
    const contributionSales=db.prepare(`SELECT t.business_id AS businessId,b.name AS businessName,COALESCE(SUM(t.sales_amount),0) AS sales,COALESCE(SUM(t.cost_amount),0) AS cost,COALESCE(SUM(t.profit_amount),0) AS importedProfit,COUNT(*) AS transactions FROM sales_transactions t JOIN businesses b ON b.id=t.business_id WHERE t.company_id=? AND t.transaction_date BETWEEN ? AND ? AND t.business_id IN (${ph})${contributionFilter} GROUP BY t.business_id,b.name ORDER BY sales DESC`).all(...contributionParams);
    contributionRows=contributionSales.map(r=>({businessId:r.businessId,businessName:r.businessName,sales:Number(r.sales||0),costOfGoods:Number(r.cost||0),grossProfit:Number(r.sales||0)-Number(r.cost||0),importedProfit:Number(r.importedProfit||0),transactions:Number(r.transactions||0)}));
  }

  let estimatedBalance = null;
  let nextPayable = null;
  if (fullMonth) {
    const cumulativePurchaseScope = purchaseScope(req,businessId);
    const cpParams=[req.user.company_id,monthEnd,...cumulativePurchaseScope.params];
    const cumulativePurchases=Number(db.prepare(`SELECT COALESCE(SUM(c.amount),0) AS total FROM capital_contributions c WHERE c.company_id=? AND c.period_end<=?${cumulativePurchaseScope.sql}`).get(...cpParams).total||0);
    const cumulativeSalesScope=salesScope(req,businessId);
    const ccParams=[req.user.company_id,monthEnd,...cumulativeSalesScope.params];
    const cumulativeCogs=Number(db.prepare(`SELECT COALESCE(SUM(t.cost_amount),0) AS total FROM sales_transactions t WHERE t.company_id=? AND t.transaction_date<=?${cumulativeSalesScope.sql}`).get(...ccParams).total||0);
    estimatedBalance=cumulativePurchases-cumulativeCogs;
    nextPayable=Number(sales.cost||0);
  }

  const vendorParams=[req.user.company_id,start,end];
  let vendorSql='';
  if (businessId) { vendorSql=' AND v.business_id=?'; vendorParams.push(businessId); }
  else if (!isManagement(req)) { vendorSql=' AND v.business_id IN (SELECT business_id FROM user_business_access WHERE user_id=?)'; vendorParams.push(req.user.user_id); }
  const vendorPaymentSummary=db.prepare(`SELECT COALESCE(SUM(v.amount),0) AS total,COUNT(*) AS count FROM vendor_payments v WHERE v.company_id=? AND v.payment_date BETWEEN ? AND ?${vendorSql}`).get(...vendorParams);
  const businessRows = businessScopeIds.length ? db.prepare(`SELECT id,name FROM businesses WHERE company_id=? AND is_active=1 AND id IN (${businessScopeIds.map(()=>'?').join(',')}) ORDER BY name`).all(req.user.company_id,...businessScopeIds) : [];
  const businessManager = roleOf(req) === 'business_manager';
  const totals = {sales:Number(sales.sales||0),costOfGoods:Number(sales.cost||0),gross:Number(sales.gross||0),returns:Number(sales.returns||0),importedProfit:Number(sales.importedProfit||0),grossProfit,expenses:Number(expenses.total||0),expenseCount:Number(expenses.count||0),payroll,ownerExpense,ownerPercent,defaultOwnerPercent,netProfit,transactions:Number(sales.transactions||0),activeBusinesses:Number(sales.activeBusinesses||0),vendorPayments:Number(vendorPaymentSummary.total||0),vendorPaymentCount:Number(vendorPaymentSummary.count||0)};
  if (!businessManager) totals.purchases = currentPurchases;
  const planning = businessManager ? null : {estimatedBalance,nextMonthPurchaseGuide:nextPayable,nextMonthEstimatedPayable:nextPayable,additionalFundingRequired:Math.max(0,-Number(estimatedBalance||0))};
  res.json({month,start,end,fullMonth,businessId:businessId||null,companyWide:!businessId&&isManagement(req),businesses:businessRows,contributions:contributionRows,ownerAllocation:ownerOnly?{defaultPercent:defaultOwnerPercent,allocations:allocationRows,selectedExcluded,months:ownerMonths,totalExpense:ownerExpense}:null,totals,planning});
});

const ownerSchema = z.object({businessId:z.string().min(1),month:z.string().regex(/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/),percent:z.number().min(0).max(100)});
const ownerDefaultSchema=z.object({month:z.string().regex(/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/),percent:z.number().min(0).max(100)});
const ownerAllocationSchema=z.object({businessId:z.string().min(1),month:z.string().regex(/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/),percent:z.number().min(0).max(100),excluded:z.boolean().optional().default(false)});
function ownerAccess(req){return roleOf(req)==='owner';}

router.put('/api/dashboard/owner-default', requireAuth, (req,res) => {
  if (!ownerAccess(req)) return res.status(403).json({error:'Only the Owner can set the owner expense default.'});
  const parsed=ownerDefaultSchema.safeParse(req.body||{}); if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message||'Invalid owner expense default.'});
  const {month,percent}=parsed.data; const stamp=nowIso();
  db.prepare(`INSERT INTO dashboard_owner_defaults(id,company_id,month,percent,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(company_id,month) DO UPDATE SET percent=excluded.percent,updated_at=excluded.updated_at`).run(id('oad'),req.user.company_id,month,percent,req.user.user_id,stamp,stamp);
  audit(req,{action:'owner_allocation.default.updated',entityType:'owner_allocation_default',entityId:`${req.user.company_id}:${month}`,details:{month,percent}});
  res.json({month,percent});
});

router.put('/api/dashboard/owner-adjustment', requireAuth, (req,res) => {
  if (!ownerAccess(req)) return res.status(403).json({error:'Only the Owner can set owner expense adjustments.'});
  const parsed=ownerSchema.safeParse(req.body||{}); if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message||'Invalid owner expense adjustment.'});
  const {businessId,month,percent}=parsed.data;
  if(!db.prepare('SELECT id FROM businesses WHERE id=? AND company_id=? AND is_active=1').get(businessId,req.user.company_id))return res.status(404).json({error:'Business not found.'});
  const stamp=nowIso();
  db.prepare(`INSERT INTO dashboard_owner_adjustments(id,company_id,business_id,month,percent,excluded,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,business_id,month) DO UPDATE SET percent=excluded.percent,excluded=0,updated_at=excluded.updated_at`).run(id('oadj'),req.user.company_id,businessId,month,percent,0,req.user.user_id,stamp,stamp);
  audit(req,{action:'owner_allocation.adjustment.updated',entityType:'owner_allocation_adjustment',entityId:`${businessId}:${month}`,businessId,details:{month,percent,excluded:false}});
  res.json({businessId,month,percent,excluded:false});
});

router.put('/api/dashboard/owner-allocation', requireAuth, (req,res) => {
  if (!ownerAccess(req)) return res.status(403).json({error:'Only the Owner can manage owner allocations.'});
  const parsed=ownerAllocationSchema.safeParse(req.body||{}); if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message||'Invalid owner allocation.'});
  const {businessId,month,percent,excluded}=parsed.data;
  if(!db.prepare('SELECT id FROM businesses WHERE id=? AND company_id=? AND is_active=1').get(businessId,req.user.company_id))return res.status(404).json({error:'Business not found.'});
  const stamp=nowIso();
  db.prepare(`INSERT INTO dashboard_owner_adjustments(id,company_id,business_id,month,percent,excluded,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,business_id,month) DO UPDATE SET percent=excluded.percent,excluded=excluded.excluded,updated_at=excluded.updated_at`).run(id('oadj'),req.user.company_id,businessId,month,percent,excluded?1:0,req.user.user_id,stamp,stamp);
  audit(req,{action:'owner_allocation.updated',entityType:'owner_allocation_adjustment',entityId:`${businessId}:${month}`,businessId,details:{month,percent,excluded}});
  res.json({businessId,month,percent,excluded});
});

router.delete('/api/dashboard/owner-allocation/:businessId/:month', requireAuth, (req,res) => {
  if (!ownerAccess(req)) return res.status(403).json({error:'Only the Owner can reset owner allocations.'});
  const {businessId,month}=req.params;
  if(!validMonth(month))return res.status(400).json({error:'Invalid month.'});
  db.prepare('DELETE FROM dashboard_owner_adjustments WHERE company_id=? AND business_id=? AND month=?').run(req.user.company_id,businessId,month);
  audit(req,{action:'owner_allocation.reset',entityType:'owner_allocation_adjustment',entityId:`${businessId}:${month}`,businessId,details:{month}});
  res.json({businessId,month,reset:true});
});

router.get('/api/dashboard/owner-allocations', requireAuth, (req,res) => {
  if (!ownerAccess(req)) return res.status(403).json({error:'Only the Owner can view owner allocations.'});
  const month=validMonth(req.query.month)?String(req.query.month):new Date().toISOString().slice(0,7);
  const defaultRow=db.prepare('SELECT percent FROM dashboard_owner_defaults WHERE company_id=? AND month=?').get(req.user.company_id,month);
  const rows=db.prepare(`SELECT o.business_id AS businessId,b.name AS businessName,o.percent,o.excluded FROM dashboard_owner_adjustments o JOIN businesses b ON b.id=o.business_id WHERE o.company_id=? AND o.month=? AND b.is_active=1 ORDER BY b.name`).all(req.user.company_id,month);
  res.json({month,defaultPercent:Number(defaultRow?.percent||0),allocations:rows});
});

module.exports=router;
