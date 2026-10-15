const express = require('express');
const { z } = require('zod');
const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { requireAuth, requirePermission } = require('../auth/middleware');
const { audit } = require('../audit/auditService');
const { requireIdempotency } = require('../security/idempotency');
const router = express.Router();

const schema = z.object({
  businessId: z.string().min(1).nullable().optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.coerce.number().min(0),
  entryMode: z.enum(['individual','monthly_total']).default('individual'),
  note: z.string().max(500).optional().default('')
});
function dateRange(value, fallbackStart, fallbackEnd) {
  const selected=value.purchaseDate||value.periodStart||fallbackStart;
  if(!selected)return null;
  if(value.entryMode==='monthly_total'){
    const month=selected.slice(0,7);
    return {periodStart:`${month}-01`,periodEnd:`${month}-${String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0')}`};
  }
  const end=value.purchaseDate?selected:(value.periodEnd||fallbackEnd||selected);
  return {periodStart:selected,periodEnd:end};
}

const unrestricted = ['owner','general_manager','administrator','admin'];
function canAccessBusiness(req, businessId) {
  if (!businessId) return unrestricted.includes(req.user.role);
  if (unrestricted.includes(req.user.role) || req.user.role === 'accountant') return true;
  return !!db.prepare('SELECT 1 FROM user_business_access WHERE user_id=? AND business_id=?').get(req.user.user_id, businessId);
}

function monthsCovered(start, end) {
  const result = [];
  const cursor = new Date(`${start.slice(0,7)}-01T00:00:00Z`);
  const finish = new Date(`${end.slice(0,7)}-01T00:00:00Z`);
  while (cursor <= finish) {
    result.push(cursor.toISOString().slice(0,7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function conflictingPurchase(req, value, ignoreId = null) {
  const businessId = value.businessId || null;
  const wantedMonths = new Set(monthsCovered(value.periodStart, value.periodEnd));
  const existing = db.prepare(`
    SELECT id,period_start AS periodStart,period_end AS periodEnd,entry_mode AS entryMode
    FROM capital_contributions
    WHERE company_id=? AND ((business_id=?) OR (business_id IS NULL AND ? IS NULL))
  `).all(req.user.company_id, businessId, businessId);
  return existing.find(row => {
    if (ignoreId && row.id === ignoreId) return false;
    const modesConflict = value.entryMode === 'monthly_total' || row.entryMode === 'monthly_total';
    if (!modesConflict) return false;
    return monthsCovered(row.periodStart, row.periodEnd).some(month => wantedMonths.has(month));
  }) || null;
}

router.get('/api/capital', requireAuth, requirePermission('capital.view'), (req,res)=>{
  const params=[req.user.company_id];
  let scope='';
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
  const start=String(req.query.start||''),end=String(req.query.end||'');
  if((start||end)&&(!validDate(start)||!validDate(end)||start>end))return res.status(400).json({error:'Choose a valid start and end date.'});
  let dateFilter='';if(start&&end){dateFilter=' AND c.period_start<=? AND c.period_end>=?';params.push(end,start);}
  if (!unrestricted.includes(req.user.role) && req.user.role !== 'accountant') {
    scope=' AND c.business_id IN (SELECT business_id FROM user_business_access WHERE user_id=?)';
    params.push(req.user.user_id);
  }
  const rows=db.prepare(`SELECT c.id,c.business_id AS businessId,b.name AS businessName,c.period_start AS periodStart,c.period_end AS periodEnd,c.amount,c.entry_mode AS entryMode,c.note,c.created_by AS createdBy,c.created_at AS createdAt,c.updated_at AS updatedAt
    FROM capital_contributions c LEFT JOIN businesses b ON b.id=c.business_id
    WHERE c.company_id=?${dateFilter}${scope} ORDER BY c.period_start DESC,c.created_at DESC`).all(...params);
  res.json({start:start||null,end:end||null,contributions:rows});
});

router.post('/api/capital', requireAuth, requirePermission('capital.manage'), requireIdempotency, (req,res)=>{
  const p=schema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.issues[0]?.message||'Invalid capital entry.'});
  const v=p.data;
  const range=dateRange(v); if(!range)return res.status(400).json({error:'Purchase date is required.'}); Object.assign(v,range);
  if(v.periodEnd<v.periodStart)return res.status(400).json({error:'Purchase date cannot be after its end date.'});
  if(!v.businessId && !unrestricted.includes(req.user.role))return res.status(403).json({error:'A business must be selected for this role.'});
  if(v.businessId && !db.prepare('SELECT id FROM businesses WHERE id=? AND company_id=?').get(v.businessId,req.user.company_id))return res.status(404).json({error:'Business not found.'});
  if(v.businessId && !canAccessBusiness(req,v.businessId))return res.status(403).json({error:'You do not have access to this business.'});
  if(v.entryMode==='monthly_total' && v.periodStart.slice(0,7)!==v.periodEnd.slice(0,7))return res.status(400).json({error:'Monthly totals must cover one calendar month.'});
  const conflict=conflictingPurchase(req,v);
  if(conflict)return res.status(409).json({error:v.entryMode==='monthly_total'?'A monthly total or individual purchase already exists for this business and month. Remove the existing records before entering a monthly total.':'A monthly total already exists for this business and month. Remove it before entering individual purchases.'});
  const cid=id('cap'),now=nowIso();
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO capital_contributions (id,company_id,business_id,period_start,period_end,amount,entry_mode,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(cid,req.user.company_id,v.businessId||null,v.periodStart,v.periodEnd,v.amount,v.entryMode,v.note||null,req.user.user_id,now,now);
    audit(req,{action:'capital.created',entityType:'capital_contribution',entityId:cid,businessId:v.businessId||null,details:{amount:v.amount,entryMode:v.entryMode,periodStart:v.periodStart,periodEnd:v.periodEnd}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Capital record could not be created.'});}
  res.status(201).json({id:cid});
});


router.patch('/api/capital/:id', requireAuth, requirePermission('capital.manage'), (req,res)=>{
  const current=db.prepare('SELECT * FROM capital_contributions WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!current)return res.status(404).json({error:'Capital record not found.'});
  // Company-wide roles may change any record. Anyone else who holds capital.manage (for example through an individual
  // permission override) follows the same rule as delete: only records they created for a business they are assigned to.
  const companyWide=unrestricted.includes(req.user.role);
  if(!companyWide && !(current.created_by===req.user.user_id && current.business_id && canAccessBusiness(req,current.business_id)))
    return res.status(403).json({error:'Only the Owner or the user who created this assigned-business record can change it.'});
  const p=schema.partial().safeParse(req.body||{});
  if(!p.success)return res.status(400).json({error:p.error.issues[0]?.message||'Invalid update.'});
  const v={
    businessId: p.data.businessId !== undefined ? p.data.businessId : (current.business_id || null),
    periodStart: p.data.periodStart !== undefined ? p.data.periodStart : current.period_start,
    periodEnd: p.data.periodEnd !== undefined ? p.data.periodEnd : current.period_end,
    amount: p.data.amount !== undefined ? p.data.amount : current.amount,
    entryMode: p.data.entryMode !== undefined ? p.data.entryMode : current.entry_mode,
    note: p.data.note !== undefined ? p.data.note : (current.note || '')
  };
  const range=dateRange({...v,...p.data},current.period_start,current.period_end); if(!range)return res.status(400).json({error:'Purchase date is required.'}); Object.assign(v,range);
  if(v.periodEnd<v.periodStart)return res.status(400).json({error:'Period end cannot be before period start.'});
  if(v.entryMode==='monthly_total' && v.periodStart.slice(0,7)!==v.periodEnd.slice(0,7))return res.status(400).json({error:'Monthly totals must cover one calendar month.'});
  if(v.businessId && !db.prepare('SELECT id FROM businesses WHERE id=? AND company_id=?').get(v.businessId,req.user.company_id))return res.status(404).json({error:'Business not found.'});
  if(!companyWide && (!v.businessId || !canAccessBusiness(req,v.businessId)))return res.status(403).json({error:'You do not have access to this business.'});
  const conflict=conflictingPurchase(req,v,current.id);
  if(conflict)return res.status(409).json({error:v.entryMode==='monthly_total'?'A monthly total or individual purchase already exists for this business and month. Remove the existing records before entering a monthly total.':'A monthly total already exists for this business and month. Remove it before entering individual purchases.'});
  const now=nowIso();
  const tx=db.transaction(()=>{
    db.prepare('UPDATE capital_contributions SET business_id=?,period_start=?,period_end=?,amount=?,entry_mode=?,note=?,updated_at=? WHERE id=? AND company_id=?')
      .run(v.businessId||null,v.periodStart,v.periodEnd,Number(v.amount),v.entryMode,v.note||null,now,current.id,req.user.company_id);
    audit(req,{action:'capital.updated',entityType:'capital_contribution',entityId:current.id,businessId:v.businessId||null,details:{amount:Number(v.amount),entryMode:v.entryMode}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Capital record could not be updated.'});}
  res.json({id:current.id});
});

router.delete('/api/capital/:id', requireAuth, requirePermission('capital.manage'), (req,res)=>{
  const current=db.prepare('SELECT * FROM capital_contributions WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!current)return res.status(404).json({error:'Purchase record not found.'});
  const isOwner=unrestricted.includes(req.user.role);
  // Any non-company-wide user holding capital.manage (role default or individual override) may delete only their own assigned-business records.
  const isOwnManagerRecord=current.created_by===req.user.user_id && current.business_id && canAccessBusiness(req,current.business_id);
  if (!isOwner && !isOwnManagerRecord) return res.status(403).json({error:'Only the Owner or the user who created this assigned-business record can delete it.'});
  const tx=db.transaction(()=>{
    db.prepare('DELETE FROM capital_contributions WHERE id=? AND company_id=?').run(current.id,req.user.company_id);
    audit(req,{action:'capital.deleted',entityType:'capital_contribution',entityId:current.id,businessId:current.business_id||null,details:{amount:Number(current.amount||0),entryMode:current.entry_mode}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Capital record could not be deleted.'});}
  res.json({id:current.id});
});

router.get('/api/capital/return', requireAuth, requirePermission('capital.view'), (req,res)=>{
  const start=String(req.query.start||''),end=String(req.query.end||''),businessId=req.query.businessId?String(req.query.businessId):null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return res.status(400).json({error:'Valid start and end dates are required.'});
  if(businessId&&!canAccessBusiness(req,businessId))return res.status(403).json({error:'You do not have access to this business.'});
  const sales=businessId?db.prepare(`SELECT COALESCE(SUM(profit_amount),0) AS profit,COALESCE(SUM(sales_amount),0) AS sales FROM sales_transactions WHERE company_id=? AND business_id=? AND transaction_date BETWEEN ? AND ?`).get(req.user.company_id,businessId,start,end):db.prepare(`SELECT COALESCE(SUM(profit_amount),0) AS profit,COALESCE(SUM(sales_amount),0) AS sales FROM sales_transactions WHERE company_id=? AND transaction_date BETWEEN ? AND ?`).get(req.user.company_id,start,end);
  const cap=businessId?db.prepare(`SELECT COALESCE(SUM(amount),0) AS amount FROM capital_contributions WHERE company_id=? AND business_id=? AND period_start>=? AND period_end<=?`).get(req.user.company_id,businessId,start,end):db.prepare(`SELECT COALESCE(SUM(amount),0) AS amount FROM capital_contributions WHERE company_id=? AND period_start>=? AND period_end<=?`).get(req.user.company_id,start,end);
  const invested=Number(cap.amount||0),profit=Number(sales.profit||0);
  res.json({profit,sales:Number(sales.sales||0),capitalInvested:invested,profitOnCapitalPercent:invested>0?(profit/invested)*100:null,metric:'Profit on Capital (%)',formula:'Profit ÷ Capital Invested × 100'});
});
module.exports=router;
