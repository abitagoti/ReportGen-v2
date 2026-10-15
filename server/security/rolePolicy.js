const ADMIN_ROLES = new Set(['administrator','admin']);
const ROLE_LEVEL = Object.freeze({
  viewer:10,
  business_manager:40,
  accountant:50,
  general_manager:70,
  owner:80,
  administrator:100,
  admin:100
});

function normalizeRole(role){return String(role||'').trim().toLowerCase();}
function isAdministrator(user){return ADMIN_ROLES.has(normalizeRole(user?.role));}
function roleLevel(role){return ROLE_LEVEL[normalizeRole(role)]||0;}
function canManageTargetRole(actor,targetRole){
  const target=normalizeRole(targetRole);
  return isAdministrator(actor) || (!ADMIN_ROLES.has(target) && roleLevel(target)<=roleLevel(actor?.role));
}
function canEditRole(actorRole,targetRole){
  const actor=normalizeRole(actorRole);
  const target=normalizeRole(targetRole);
  // A user's own role permissions must never be editable by that user.
  // Otherwise an actor with roles.manage could grant the permissions that
  // roles.manage controls and escalate their own access.
  if(actor===target) return false;
  return ADMIN_ROLES.has(actor) || (!ADMIN_ROLES.has(target) && roleLevel(target)<=roleLevel(actor));
}
// Individual permission overrides change what an account can do, so they follow the same strictly-lower
// rule as role permissions. Peers (two Owners, two General Managers) may still manage each other's
// status and business access, but cannot raise or strip each other's permissions, which would let one
// peer lock the other out of users.manage / roles.manage.
function canOverrideTarget(actor,targetRole){
  const target=normalizeRole(targetRole);
  if(ADMIN_ROLES.has(target)) return false;
  return isAdministrator(actor) || roleLevel(target)<roleLevel(actor?.role);
}
module.exports={ADMIN_ROLES,ROLE_LEVEL,normalizeRole,isAdministrator,roleLevel,canManageTargetRole,canEditRole,canOverrideTarget};
