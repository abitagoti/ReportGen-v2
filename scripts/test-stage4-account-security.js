const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const policy=require(path.join(root,'server','security','rolePolicy.js'));
function assert(condition,message){if(!condition)throw new Error(message)}
assert(policy.canManageTargetRole({role:'administrator'},'owner'),'Administrator should manage Owner.');
assert(policy.canManageTargetRole({role:'owner'},'general_manager'),'Owner should manage General Manager.');
assert(!policy.canManageTargetRole({role:'general_manager'},'owner'),'General Manager must not manage Owner.');
assert(policy.canEditRole('administrator','owner'),'Administrator should edit Owner permissions.');
assert(policy.canEditRole('owner','general_manager'),'Owner should edit General Manager permissions.');
assert(!policy.canEditRole('general_manager','owner'),'General Manager must not edit Owner permissions.');
assert(!policy.canEditRole('owner','owner'),'A user must not edit their own role permissions.');
const users=fs.readFileSync(path.join(root,'server','users','userRoutes.js'),'utf8');
const auth=fs.readFileSync(path.join(root,'server','auth','authRoutes.js'),'utf8');
assert(users.includes('System Administrator account is protected'),'System Administrator deletion protection missing.');
assert(users.includes(".filter(user => String(user.id) === String(req.user.user_id) || canManageTargetRole(req.user, user.role))"),'Server-side manageable-user filtering missing.');
assert(auth.includes("router.post('/api/auth/change-password'"),'Self-service password route missing.');
assert(auth.includes("db.prepare('DELETE FROM sessions WHERE user_id=?')"),'Password-change session invalidation missing.');
console.log('STAGE4_ACCOUNT_SECURITY_TEST=PASS');
