const express = require('express');
const { z } = require('zod');
const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { requireAuth, requirePermission } = require('../auth/middleware');
const { audit } = require('../audit/auditService');
const { requireIdempotency } = require('../security/idempotency');
const router = express.Router();

const managementRoles = ['owner','general_manager','administrator','admin'];
const isManagement = req => managementRoles.includes(String(req.user.role || '').toLowerCase());
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
function validDate(v){
  if(!dateRe.test(String(v||''))) return false;
  const [y,m,d]=String(v).split('-').map(Number);
  const x=new Date(Date.UTC(y,m-1,d));
  return x.getUTCFullYear()===y && x.getUTCMonth()===m-1 && x.getUTCDate()===d;
}
function canUseBusiness(req,businessId){
  if(!businessId) return isManagement(req);
  if(isManagement(req)) return !!db.prepare('SELECT 1 FROM businesses WHERE id=? AND company_id=?').get(businessId,req.user.company_id);
  return !!db.prepare('SELECT 1 FROM user_business_access a JOIN businesses b ON b.id=a.business_id WHERE a.user_id=? AND a.business_id=? AND b.company_id=? AND b.is_active=1').get(req.user.user_id,businessId,req.user.company_id);
}

const schema=z.object({
  paymentDate:z.string().regex(dateRe),
  businessId:z.string().min(1).nullable().optional(),
  amount:z.coerce.number().positive(),
  note:z.string().max(500).optional().default('')
});

router.get('/api/vendor-payments', requireAuth, requirePermission('vendor_payments.view'), (req,res)=>{
  const start=String(req.query.start||''), end=String(req.query.end||'');
  if((start||end)&&(!validDate(start)||!validDate(end)||start>end)) return res.status(400).json({error:'Choose a valid start and end date.'});
  const businessId=req.query.businessId?String(req.query.businessId):null;
  if(businessId && !canUseBusiness(req,businessId)) return res.status(403).json({error:'You do not have access to this business.'});
  const params=[req.user.company_id]; let where='';
  if(start&&end){where+=' AND v.payment_date BETWEEN ? AND ?';params.push(start,end);}
  if(businessId){where+=' AND v.business_id=?';params.push(businessId);}
  if(!isManagement(req)){where+=' AND v.business_id IN (SELECT business_id FROM user_business_access WHERE user_id=?)';params.push(req.user.user_id);}
  const rows=db.prepare(`SELECT v.id,v.business_id AS businessId,b.name AS businessName,v.payment_date AS paymentDate,v.amount,v.note,v.created_by AS createdBy,v.created_at AS createdAt,v.updated_at AS updatedAt\n    FROM vendor_payments v LEFT JOIN businesses b ON b.id=v.business_id\n    WHERE v.company_id=?${where} ORDER BY v.payment_date DESC,v.created_at DESC`).all(...params);
  const total=rows.reduce((sum,row)=>sum+Number(row.amount||0),0);
  res.json({start:start||null,end:end||null,businessId,rows,total,count:rows.length});
});

router.post('/api/vendor-payments', requireAuth, requirePermission('vendor_payments.manage'), requireIdempotency, (req,res)=>{
  const parsed=schema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message||'Invalid vendor payment.'});
  const v=parsed.data;
  if(!canUseBusiness(req,v.businessId||null))return res.status(403).json({error:'You do not have access to this business.'});
  const business=v.businessId?db.prepare('SELECT id FROM businesses WHERE id=? AND company_id=?').get(v.businessId,req.user.company_id):null;
  if(v.businessId&&!business)return res.status(400).json({error:'Selected business was not found.'});
  const stamp=nowIso(), paymentId=id('vpay');
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO vendor_payments(id,company_id,business_id,payment_date,amount,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(paymentId,req.user.company_id,v.businessId||null,v.paymentDate,v.amount,v.note||'',req.user.user_id,stamp,stamp);
    audit(req,{action:'vendor_payment.created',entityType:'vendor_payment',entityId:paymentId,businessId:v.businessId||null,details:{paymentDate:v.paymentDate,amount:Number(v.amount),note:v.note||''}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Vendor payment could not be recorded.'});}
  res.status(201).json({id:paymentId});
});

router.patch('/api/vendor-payments/:id', requireAuth, requirePermission('vendor_payments.manage'), (req,res)=>{
  const current=db.prepare('SELECT * FROM vendor_payments WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!current)return res.status(404).json({error:'Vendor payment not found.'});
  const parsed=schema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message||'Invalid vendor payment.'});
  const v=parsed.data;
  if(!canUseBusiness(req,v.businessId||null))return res.status(403).json({error:'You do not have access to this business.'});
  if(v.businessId&&!db.prepare('SELECT 1 FROM businesses WHERE id=? AND company_id=?').get(v.businessId,req.user.company_id))return res.status(400).json({error:'Selected business was not found.'});
  const tx=db.transaction(()=>{
    db.prepare('UPDATE vendor_payments SET business_id=?,payment_date=?,amount=?,note=?,updated_at=? WHERE id=? AND company_id=?').run(v.businessId||null,v.paymentDate,v.amount,v.note||'',nowIso(),current.id,req.user.company_id);
    audit(req,{action:'vendor_payment.updated',entityType:'vendor_payment',entityId:current.id,businessId:v.businessId||null,details:{previousAmount:Number(current.amount||0),amount:Number(v.amount),paymentDate:v.paymentDate,note:v.note||''}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Vendor payment could not be updated.'});}
  res.json({ok:true});
});

router.delete('/api/vendor-payments/:id', requireAuth, requirePermission('vendor_payments.manage'), (req,res)=>{
  const current=db.prepare('SELECT id,business_id AS businessId,amount,payment_date AS paymentDate FROM vendor_payments WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!current)return res.status(404).json({error:'Vendor payment not found.'});
  if(!canUseBusiness(req,current.businessId||null))return res.status(403).json({error:'You do not have access to this business.'});
  const tx=db.transaction(()=>{
    db.prepare('DELETE FROM vendor_payments WHERE id=? AND company_id=?').run(current.id,req.user.company_id);
    audit(req,{action:'vendor_payment.deleted',entityType:'vendor_payment',entityId:current.id,businessId:current.businessId||null,details:{amount:Number(current.amount||0),paymentDate:current.paymentDate}});
  });
  try{tx();}catch(e){return res.status(400).json({error:e.message||'Vendor payment could not be deleted.'});}
  res.json({ok:true});
});

module.exports=router;
