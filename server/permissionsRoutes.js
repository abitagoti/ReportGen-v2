const express=require('express');
const {requireAuth,requirePermission}=require('./auth/middleware');
const {PERMISSIONS,listPermissions,listUserPermissions,effectivePermissionSet,savePermissions,saveUserPermissionOverrides,hasPermission}=require('./permissions');
const {audit}=require('./audit/auditService');
const {ADMIN_ROLES,canEditRole,canOverrideTarget,normalizeRole}=require('./security/rolePolicy');
const router=express.Router();
const roles=['administrator','admin','owner','general_manager','accountant','business_manager','viewer'];

function effectivePermissions(req){
  // The signed-in user's resolved permissions, including individual overrides, so role management checks
  // agree with the permissions enforced by API routes.
  return effectivePermissionSet(req);
}

// Effective permissions for the signed-in user, including individual allow/deny overrides.
router.get('/api/permissions/effective',requireAuth,(req,res)=>{
  res.json({role:normalizeRole(req.user.role),permissions:listUserPermissions(req.user.company_id,req.user.user_id,req.user.role)});
});

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

router.get('/api/users/:userId/permissions',requireAuth,requirePermission('users.manage'),(req,res)=>{
  const target=dbUser(req.params.userId,req.user.company_id);
  if(!target)return res.status(404).json({error:'User not found.'});
  if(String(target.id)===String(req.user.user_id))return res.status(403).json({error:'You cannot edit your own individual permissions.'});
  if(!canOverrideTarget(req.user,target.role))return res.status(403).json({error:'You can only change individual permissions for accounts below your own role.'});
  res.json({user:{id:target.id,username:target.username,displayName:target.display_name,role:target.role},permissions:listUserPermissions(req.user.company_id,target.id,target.role)});
});
router.put('/api/users/:userId/permissions',requireAuth,requirePermission('users.manage'),(req,res)=>{
  const target=dbUser(req.params.userId,req.user.company_id);
  if(!target)return res.status(404).json({error:'User not found.'});
  if(String(target.id)===String(req.user.user_id))return res.status(403).json({error:'You cannot edit your own individual permissions.'});
  if(!canOverrideTarget(req.user,target.role))return res.status(403).json({error:'You can only change individual permissions for accounts below your own role.'});
  if(ADMIN_ROLES.has(normalizeRole(target.role)))return res.status(403).json({error:'Administrator permissions are protected.'});
  const overrides=req.body?.overrides;
  if(!overrides || typeof overrides!=='object' || Array.isArray(overrides))return res.status(400).json({error:'Permission overrides must be an object.'});
  const valid=new Set(PERMISSIONS.map(([key])=>key));
  if(Object.entries(overrides).some(([key,value])=>!valid.has(key)||!['inherit','allow','deny'].includes(value)))return res.status(400).json({error:'One or more permission overrides are invalid.'});
  const actorRole=normalizeRole(req.user.role);
  const actorPermissions=effectivePermissions(req);
  if(!ADMIN_ROLES.has(actorRole)&&Object.entries(overrides).some(([key,value])=>value==='allow'&&!actorPermissions.has(key)))return res.status(403).json({error:'You cannot grant a permission your account does not currently have.'});
  const stored=Object.fromEntries(Object.entries(overrides).filter(([,value])=>value!=='inherit'));
  saveUserPermissionOverrides(req.user.company_id,target.id,stored,req.user.user_id);
  audit(req,{action:'user.permissions.updated',entityType:'user',entityId:target.id,details:{overrides:stored}});
  res.json({userId:target.id,permissions:listUserPermissions(req.user.company_id,target.id,target.role)});
});
function dbUser(userId,companyId){return require('./database/database').db.prepare('SELECT id,username,display_name,role FROM users WHERE id=? AND company_id=?').get(String(userId),String(companyId));}

module.exports=router;
