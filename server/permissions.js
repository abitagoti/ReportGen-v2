const { db } = require('./database/database');
const { id } = require('./lib/ids');
const { nowIso } = require('./lib/time');

const PERMISSIONS = [
  ['dashboard.view','Dashboard'],['businesses.view','Businesses'],['businesses.manage','Manage businesses'],['sales.view','Sales'],['sales.import','Import sales'],
  ['history.view','Import history'],['expenses.view','Expenses'],['expenses.manage','Manage expenses'],
  ['capital.view','Purchases'],['capital.manage','Manage purchases'],['vendor_payments.view','Vendor payments'],['vendor_payments.manage','Manage vendor payments'],['analytics.view','Analytics'],['comparison.view','Company comparison'],
  ['reports.view','Reports'],['audit.view','Audit log'],['messages.send','Send internal messages'],['payroll.view','View payroll'],['payroll.salaries','View salaries and per-employee pay'],['payroll.create','Create payroll'],['payroll.edit','Edit payroll'],
  ['payroll.finalize','Finalize payroll'],['payroll.deductions','Manage deductions'],['payroll.loans','Manage loans'],
  ['staff.view','View staff'],['staff.manage','Manage staff'],['shared_expenses.view','View shared expenses and allocation history'],['external_businesses.view','View external business pages and financial records'],['users.manage','Manage users'],['roles.manage','Manage roles'],['settings.manage','Manage settings']
];
const ALL = PERMISSIONS.map(x=>x[0]);
const DEFAULTS = {
  administrator: ALL,
  admin: ALL,
  owner: ALL,
  general_manager: ALL.filter(x=>x!=='payroll.loans'),
  accountant: ['dashboard.view','businesses.view','expenses.view','expenses.manage','shared_expenses.view','external_businesses.view','payroll.view','payroll.salaries','payroll.create','payroll.deductions','capital.view','reports.view','audit.view','messages.send'],
  business_manager: ['dashboard.view','businesses.view','sales.view','sales.import','history.view','expenses.view','analytics.view','reports.view','payroll.view','staff.view','messages.send'],
  viewer: ['dashboard.view','businesses.view','reports.view']
};
function roleDefaults(role){return DEFAULTS[role]||DEFAULTS.viewer;}
function listPermissions(companyId, role){
  const rows=db.prepare('SELECT permission,enabled FROM role_permissions WHERE company_id=? AND role=?').all(companyId,role);
  const overrides=new Map(rows.map(r=>[r.permission,!!r.enabled]));
  return PERMISSIONS.map(([key,label])=>({key,label,enabled:overrides.has(key)?overrides.get(key):roleDefaults(role).includes(key)}));
}
function hasPermission(req, permission){
  if(['administrator','admin'].includes(String(req.user?.role||'').toLowerCase())) return true;
  return listPermissions(req.user.company_id, req.user.role).some(p=>p.key===permission&&p.enabled);
}
function requirePermission(permission){return (req,res,next)=>{if(!hasPermission(req,permission))return res.status(403).json({error:'You do not have permission for this action.'});next();};}
function savePermissions(companyId,role,permissions,userId){
  const tx=db.transaction(()=>{const stmt=db.prepare(`INSERT INTO role_permissions(id,company_id,role,permission,enabled,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(company_id,role,permission) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`);const now=nowIso();for(const p of PERMISSIONS){stmt.run(id('rperm'),companyId,role,p[0],permissions.includes(p[0])?1:0,userId,now);}});tx();
}
module.exports={PERMISSIONS,DEFAULTS,listPermissions,hasPermission,requirePermission,savePermissions};
