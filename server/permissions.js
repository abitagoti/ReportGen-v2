const { db } = require('./database/database');
const { id } = require('./lib/ids');
const { nowIso } = require('./lib/time');

const PERMISSIONS = [
  ['dashboard.view','Dashboard'],['businesses.view','Businesses'],['businesses.manage','Manage businesses'],['sales.view','Sales'],['sales.import','Import sales'],
  ['history.view','Import history'],['expenses.view','Expenses'],['expenses.manage','Manage expenses'],
  ['capital.view','Purchases'],['capital.manage','Manage purchases'],['vendor_payments.view','Vendor payments'],['vendor_payments.manage','Manage vendor payments'],['analytics.view','Analytics'],['comparison.view','Company comparison'],
  ['reports.view','Reports'],['audit.view','Audit log'],['messages.send','Send internal messages'],['payroll.view','View payroll'],['payroll.salaries','View salaries and per-employee pay'],['payroll.create','Create payroll'],['payroll.edit','Edit payroll'],
  ['payroll.finalize','Finalize payroll'],['payroll.deductions','Manage deductions'],['payroll.loans','Manage loans'],
  ['staff.view','View staff'],['staff.manage','Manage staff'],['shared_expenses.view','View shared expenses and allocation history'],['shared_expenses.manage','Manage shared expenses and allocation templates'],['external_businesses.view','View external business pages and financial records'],['external_businesses.manage','Manage external businesses, transactions and payroll'],['users.manage','Manage users'],['roles.manage','Manage roles'],['settings.manage','Manage settings']
];
const ALL = PERMISSIONS.map(x=>x[0]);
const DEFAULTS = {
  administrator: ALL,
  admin: ALL,
  owner: ALL,
  general_manager: ALL.filter(x=>x!=='payroll.loans'),
  accountant: ['dashboard.view','businesses.view','expenses.view','expenses.manage','shared_expenses.view','shared_expenses.manage','external_businesses.view','external_businesses.manage','payroll.view','payroll.salaries','payroll.create','payroll.edit','payroll.finalize','payroll.deductions','capital.view','reports.view','audit.view','messages.send'],
  business_manager: ['dashboard.view','businesses.view','sales.view','sales.import','history.view','expenses.view','analytics.view','reports.view','payroll.view','staff.view','messages.send'],
  viewer: ['dashboard.view','businesses.view','reports.view']
};
function roleDefaults(role){return DEFAULTS[role]||DEFAULTS.viewer;}
function listPermissions(companyId, role){
  const rows=db.prepare('SELECT permission,enabled FROM role_permissions WHERE company_id=? AND role=?').all(companyId,role);
  const overrides=new Map(rows.map(r=>[r.permission,!!r.enabled]));
  return PERMISSIONS.map(([key,label])=>({key,label,enabled:overrides.has(key)?overrides.get(key):roleDefaults(role).includes(key)}));
}
let cachedOverrideColumn = null;
function overrideColumn(){
  // Older development databases used `decision`; newer schemas use `effect`.
  // migrateUserPermissionOverrides() normally upgrades the table at startup, but this
  // stays tolerant so workspace boot never fails with SQLITE_ERROR.
  // The column name cannot change while the server is running, so it is looked up once
  // (it used to run PRAGMA table_info on every single permission check).
  if (cachedOverrideColumn) return cachedOverrideColumn;
  const columns = db.prepare('PRAGMA table_info(user_permission_overrides)').all().map(c => c.name);
  if (columns.includes('effect')) cachedOverrideColumn = 'effect';
  else if (columns.includes('decision')) cachedOverrideColumn = 'decision';
  else throw new Error('user_permission_overrides is missing its effect/decision column');
  return cachedOverrideColumn;
}
function listUserPermissions(companyId, userId, role){
  const base = new Map(listPermissions(companyId, role).map(p => [p.key, p.enabled]));
  const col = overrideColumn();
  const rows = db.prepare(`SELECT permission, ${col} AS override_value FROM user_permission_overrides WHERE company_id=? AND user_id=?`).all(companyId, userId);
  const byPermission = new Map();
  for (const row of rows) { byPermission.set(row.permission, row.override_value); base.set(row.permission, row.override_value === 'allow'); }
  return PERMISSIONS.map(([key,label]) => ({ key, label, enabled: !!base.get(key), override: byPermission.get(key) || 'inherit' }));
}
// Resolved permissions are cached for the lifetime of one request only. requireAuth builds a fresh
// req.user for every request, so a role/override change is always picked up by the next request.
const requestPermissionCache = new WeakMap();
function effectivePermissionSet(req){
  let set = requestPermissionCache.get(req.user);
  if (!set) {
    set = new Set(listUserPermissions(req.user.company_id, req.user.user_id, req.user.role).filter(p => p.enabled).map(p => p.key));
    requestPermissionCache.set(req.user, set);
  }
  return set;
}
function hasPermission(req, permission){
  if (!req || !req.user) return false;
  if(['administrator','admin'].includes(String(req.user.role||'').trim().toLowerCase())) return true;
  return effectivePermissionSet(req).has(permission);
}
function saveUserPermissionOverrides(companyId, userId, overrides, updatedBy){
  const valid = new Set(ALL);
  const col = overrideColumn();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_permission_overrides WHERE company_id=? AND user_id=?').run(companyId,userId);
    const stmt = db.prepare(`INSERT INTO user_permission_overrides(id,company_id,user_id,permission,${col},updated_by,updated_at) VALUES(?,?,?,?,?,?,?)`);
    const now = nowIso();
    for (const [permission,effect] of Object.entries(overrides)) {
      if (!valid.has(permission) || !['allow','deny'].includes(effect)) continue;
      stmt.run(id('uperm'),companyId,userId,permission,effect,updatedBy,now);
    }
  });
  tx();
}

function requirePermission(permission){return (req,res,next)=>{if(!hasPermission(req,permission))return res.status(403).json({error:'You do not have permission for this action.'});next();};}
function savePermissions(companyId,role,permissions,userId){
  const tx=db.transaction(()=>{const stmt=db.prepare(`INSERT INTO role_permissions(id,company_id,role,permission,enabled,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(company_id,role,permission) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`);const now=nowIso();for(const p of PERMISSIONS){stmt.run(id('rperm'),companyId,role,p[0],permissions.includes(p[0])?1:0,userId,now);}});tx();
}
module.exports={PERMISSIONS,DEFAULTS,listPermissions,listUserPermissions,effectivePermissionSet,hasPermission,requirePermission,savePermissions,saveUserPermissionOverrides};
