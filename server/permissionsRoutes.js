const express=require('express');
const {requireAuth,requirePermission}=require('./auth/middleware');
const {PERMISSIONS,listPermissions,savePermissions,hasPermission}=require('./permissions');
const {audit}=require('./audit/auditService');
const {ADMIN_ROLES,canEditRole,normalizeRole}=require('./security/rolePolicy');
const router=express.Router();
const roles=['administrator','admin','owner','general_manager','accountant','business_manager','viewer'];

function effectivePermissions(req){
  return new Set(listPermissions(req.user.company_id,req.user.role).filter(p=>p.enabled).map(p=>p.key));
}

// Reading one's own role permissions is required during workspace boot.
// Reading or managing another role requires the dedicated roles.manage permission.
router.get('/api/permissions/catalog',requireAuth,requirePermission('roles.manage'),(req,res)=>
  res.json({permissions:PERMISSIONS.map(([key,label])=>({key,label})),roles})
);

router.get('/api/permissions/:role',requireAuth,(req,res)=>{
  const role=normalizeRole(req.params.role);
  if(!roles.includes(role))return res.status(400).json({error:'Invalid role.'});
  const ownRole=normalizeRole(req.user.role);
  // Do not call requirePermission(...)(req,res,next) here: on success it calls next(),
  // and this is the last handler on the route, so the request fell through to a 404.
  if(role!==ownRole&&!hasPermission(req,'roles.manage'))return res.status(403).json({error:'You do not have permission for this action.'});
  res.json({role,permissions:listPermissions(req.user.company_id,role)});
});

router.put('/api/permissions/:role',requireAuth,requirePermission('roles.manage'),(req,res)=>{
  const role=normalizeRole(req.params.role);
  if(!roles.includes(role))return res.status(400).json({error:'Invalid role.'});
  if(!canEditRole(req.user.role,role)){
    return res.status(403).json({error:normalizeRole(req.user.role)===role?'You cannot modify permissions for your own role.':'You cannot manage permissions for this role.'});
  }
  if(ADMIN_ROLES.has(role))return res.status(403).json({error:'Administrator permissions are protected and can only be changed by an Administrator.'});
  const permissions=Array.isArray(req.body?.permissions)?[...new Set(req.body.permissions.map(String))]:[];
  const valid=new Set(PERMISSIONS.map(([key])=>key));
  if(permissions.some(p=>!valid.has(p)))return res.status(400).json({error:'One or more permissions are invalid.'});
  const actorRole=normalizeRole(req.user.role);
  const actorPermissions=effectivePermissions(req);
  if(!ADMIN_ROLES.has(actorRole) && permissions.some(p=>!actorPermissions.has(p))){
    return res.status(403).json({error:'You cannot grant a permission your account does not currently have.'});
  }
  savePermissions(req.user.company_id,role,permissions,req.user.user_id);
  audit(req,{action:'role.permissions.updated',entityType:'role',entityId:role,details:{role,permissions}});
  res.json({role,permissions:listPermissions(req.user.company_id,role)});
});
module.exports=router;
