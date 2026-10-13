const express = require('express');
const { db } = require('./database/database');
const { requireAuth } = require('./auth/middleware');
const { id } = require('./lib/ids');
const { nowIso } = require('./lib/time');
const router = express.Router();
const { hasPermission } = require('./permissions');
const { audit } = require('./audit/auditService');
// Departments and job roles are staff setup: controlled by the Manage staff permission, not by role name.
const requireManagement = (req,res,next) => hasPermission(req,'staff.manage') ? next() : res.status(403).json({error:'You need the Manage staff permission to change departments and job roles.'});

router.get('/api/organization/departments', requireAuth, (req,res)=>{
  const rows=db.prepare('SELECT id,name,is_active AS isActive FROM organization_departments WHERE company_id=? ORDER BY name').all(req.user.company_id);
  res.json({departments:rows});
});
router.post('/api/organization/departments', requireAuth, requireManagement, (req,res)=>{
  const name=String(req.body?.name||'').trim();
  if(!name)return res.status(400).json({error:'Department name is required.'});
  const stamp=nowIso(), existing=db.prepare('SELECT id,is_active AS isActive FROM organization_departments WHERE company_id=? AND lower(name)=lower(?)').get(req.user.company_id,name);
  if(existing) return res.status(409).json({error: existing.isActive ? 'Department already exists.' : 'Department exists but is inactive.'});
  const departmentId=id('dept'); db.prepare('INSERT INTO organization_departments(id,company_id,name,is_active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(departmentId,req.user.company_id,name,1,req.user.user_id,stamp,stamp);
  audit(req,{action:'organization.department.created',entityType:'department',entityId:departmentId,details:{name}}); res.status(201).json({id:departmentId,message:'Department created.'});
});
router.patch('/api/organization/departments/:id', requireAuth, requireManagement, (req,res)=>{
  const name=String(req.body?.name||'').trim(), isActive=req.body?.isActive===false?0:1;
  if(!name)return res.status(400).json({error:'Department name is required.'});
  const result=db.prepare('UPDATE organization_departments SET name=?,is_active=?,updated_at=? WHERE id=? AND company_id=?').run(name,isActive,nowIso(),req.params.id,req.user.company_id);
  if(!result.changes)return res.status(404).json({error:'Department not found.'}); audit(req,{action:'organization.department.updated',entityType:'department',entityId:req.params.id,details:{name,isActive:Boolean(isActive)}}); res.json({message:'Department updated.'});
});
router.delete('/api/organization/departments/:id', requireAuth, requireManagement, (req,res)=>{
  const current=db.prepare('SELECT id FROM organization_departments WHERE id=? AND company_id=?').get(req.params.id,req.user.company_id);
  if(!current)return res.status(404).json({error:'Department not found.'});
  const remove=db.transaction(()=>{
    db.prepare('UPDATE organization_job_roles SET department_id=NULL,updated_at=? WHERE department_id=? AND company_id=?').run(nowIso(),current.id,req.user.company_id);
    db.prepare('DELETE FROM organization_departments WHERE id=? AND company_id=?').run(current.id,req.user.company_id);
  });
  remove(); audit(req,{action:'organization.department.deleted',entityType:'department',entityId:current.id,details:{relatedJobRolesPreserved:true}}); res.json({message:'Department deleted. Related job roles were kept without a department.'});
});

router.get('/api/organization/job-roles', requireAuth, (req,res)=>{
  const rows=db.prepare(`SELECT r.id,r.name,r.department_id AS departmentId,d.name AS departmentName,r.is_active AS isActive FROM organization_job_roles r LEFT JOIN organization_departments d ON d.id=r.department_id WHERE r.company_id=? ORDER BY r.name`).all(req.user.company_id);
  res.json({jobRoles:rows});
});
router.post('/api/organization/job-roles', requireAuth, requireManagement, (req,res)=>{
  const name=String(req.body?.name||'').trim(), departmentId=req.body?.departmentId||null;
  if(!name)return res.status(400).json({error:'Job role name is required.'});
  if(departmentId && !db.prepare('SELECT id FROM organization_departments WHERE id=? AND company_id=?').get(departmentId,req.user.company_id))return res.status(400).json({error:'Selected department is invalid.'});
  const existing=db.prepare('SELECT id,is_active AS isActive FROM organization_job_roles WHERE company_id=? AND lower(name)=lower(?)').get(req.user.company_id,name);
  if(existing)return res.status(409).json({error: existing.isActive ? 'Job role already exists.' : 'Job role exists but is inactive.'});
  const stamp=nowIso(), roleId=id('job');db.prepare('INSERT INTO organization_job_roles(id,company_id,name,department_id,is_active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(roleId,req.user.company_id,name,departmentId,1,req.user.user_id,stamp,stamp);
  audit(req,{action:'organization.job_role.created',entityType:'job_role',entityId:roleId,details:{name,departmentId}}); res.status(201).json({id:roleId,message:'Job role created.'});
});
router.patch('/api/organization/job-roles/:id', requireAuth, requireManagement, (req,res)=>{
  const name=String(req.body?.name||'').trim(), departmentId=req.body?.departmentId||null, isActive=req.body?.isActive===false?0:1;
  if(!name)return res.status(400).json({error:'Job role name is required.'});
  if(departmentId && !db.prepare('SELECT id FROM organization_departments WHERE id=? AND company_id=?').get(departmentId,req.user.company_id))return res.status(400).json({error:'Selected department is invalid.'});
  const result=db.prepare('UPDATE organization_job_roles SET name=?,department_id=?,is_active=?,updated_at=? WHERE id=? AND company_id=?').run(name,departmentId,isActive,nowIso(),req.params.id,req.user.company_id);
  if(!result.changes)return res.status(404).json({error:'Job role not found.'}); audit(req,{action:'organization.job_role.updated',entityType:'job_role',entityId:req.params.id,details:{name,departmentId,isActive:Boolean(isActive)}}); res.json({message:'Job role updated.'});
});
router.delete('/api/organization/job-roles/:id', requireAuth, requireManagement, (req,res)=>{
  const result=db.prepare('DELETE FROM organization_job_roles WHERE id=? AND company_id=?').run(req.params.id,req.user.company_id);
  if(!result.changes)return res.status(404).json({error:'Job role not found.'});
  audit(req,{action:'organization.job_role.deleted',entityType:'job_role',entityId:req.params.id,details:{}});
  res.json({message:'Job role deleted.'});
});
module.exports=router;
