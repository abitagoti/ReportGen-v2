import {state,esc,can,normalizedRole} from '../state.js';
import {api} from '../api.js';
import {pageShell,toast} from '../components/ui.js';

const canManageUsers=()=>can('users.manage');
const canManageRoles=()=>can('roles.manage');
const ROLE_LEVEL={viewer:10,business_manager:40,accountant:50,general_manager:70,owner:80,administrator:100,admin:100};
const canEditRole=(targetRole)=>{const actor=normalizedRole(state.user?.role),target=normalizedRole(targetRole);if(actor===target)return false;if(['administrator','admin'].includes(actor))return true;return !['administrator','admin'].includes(target)&&(ROLE_LEVEL[target]||0)<=(ROLE_LEVEL[actor]||0);};
const canManageTargetRole=(targetRole)=>{const actor=normalizedRole(state.user?.role),target=normalizedRole(targetRole);return ['administrator','admin'].includes(actor)||(!['administrator','admin'].includes(target)&&(ROLE_LEVEL[target]||0)<=(ROLE_LEVEL[actor]||0));};
const roles=[['owner','Owner'],['general_manager','General Manager'],['administrator','Administrator'],['accountant','Accountant'],['business_manager','Business Manager'],['viewer','Viewer']];
const canCreateAdministrator=()=>['administrator','admin'].includes(String(state.user?.role||'').toLowerCase());
const assignableRoles=()=>roles.filter(([value])=>value!=='administrator'||canCreateAdministrator());

export function users(){
  const auditButton=can("audit.view")?'<button class="btn" id="auditLog">Audit log</button>':'';
  const actions=(canManageUsers()||canManageRoles())?`<div style="display:flex;gap:8px;flex-wrap:wrap">${canManageRoles()?'<button class="btn" id="rolePermissions">Role permissions</button>':''}${auditButton}${canManageUsers()?'<button class="btn primary" id="newUser">+ Add user</button>':''}</div>`:'';
  return pageShell('Users & Access',`<div class="page-intro"><div><div class="eyebrow">Company administration</div><h2>Users and access</h2><p>Review company users, roles and business access assignments.</p></div>${actions}</div><div class="panel"><div id="usersPanel"><div class="small">Loading users…</div></div></div>`);
}

export function bindUsers(){loadUsers();document.getElementById('newUser')?.addEventListener('click',()=>openUserModal());document.getElementById('rolePermissions')?.addEventListener('click',()=>openRolePermissions());document.getElementById('auditLog')?.addEventListener('click',()=>{state.page='audit';window.ReportGen.render()});}

async function loadUsers(){
  const panel=document.getElementById('usersPanel');if(!panel)return;
  try{
    const d=await api('/api/users'),users=d.users||[];
    panel.innerHTML=users.length?`<div class="table-wrap users-management-wrap"><table class="users-management-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th>${canManageUsers()?'<th>Actions</th>':''}</tr></thead><tbody>${users.map(u=>`<tr><td><strong>${esc(u.displayName||'')}</strong></td><td>${esc(u.username)}</td><td><span class="pill">${esc(roleLabel(u.role))}</span></td><td><span class="pill ${u.isActive===0?'warn':'success'}">${u.isActive===0?'Inactive':'Active'}</span></td>${canManageUsers()?`<td><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" data-access="${esc(u.id)}">Business access</button>${String(u.id)!==String(state.user?.id||state.user?.user_id)&&!['administrator','admin'].includes(normalizedRole(u.role))?`<button class="btn small ${u.isActive===0?'':'danger'}" data-user-status="${esc(u.id)}" data-active="${u.isActive===0?'0':'1'}">${u.isActive===0?'Reactivate':'Delete account'}</button>`:''}</div></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">No users found.</div>';
    panel.querySelectorAll('[data-access]').forEach(b=>b.onclick=()=>openAccessModal(users.find(u=>u.id===b.dataset.access)));
    panel.querySelectorAll('[data-user-status]').forEach(b=>b.onclick=async()=>{
      const active=b.dataset.active==='1',user=users.find(u=>u.id===b.dataset.userStatus);if(!user)return;
      if(active&&!confirm(`Delete the login account for ${user.displayName||user.username}? They will lose access immediately, and their historical records will be kept.`))return;
      try{
        if(active)await api(`/api/users/${encodeURIComponent(user.id)}`,{method:'DELETE'});
        else await api(`/api/users/${encodeURIComponent(user.id)}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isActive:true})});
        toast(active?'Account deleted. Historical records preserved.':'User account reactivated.');await loadUsers();
      }catch(err){toast(err.message)}
    });
  }catch(err){panel.innerHTML=`<div class="notice error">${esc(err.message)}</div>`;}
}
function roleLabel(role){return ({admin:'Administrator',administrator:'Administrator',owner:'Owner',general_manager:'General Manager',accountant:'Accountant',business_manager:'Business Manager',viewer:'Viewer'})[role]||role||'User';}
function openUserModal(){const m=document.createElement('div');m.className='modal-backdrop';m.innerHTML=`<div class="modal"><div class="modal-head"><div><div class="eyebrow">Access management</div><h3>Add user</h3></div><button class="close" data-close>×</button></div><form class="form-stack" style="margin-top:20px"><div class="field"><label>Display name</label><input class="input" name="displayName" required></div><div class="field"><label>Username</label><input class="input" name="username" required></div><div class="field"><label>Temporary password</label><input class="input" name="password" type="password" minlength="8" required></div><div class="field"><label>Role</label><select class="input" name="role">${assignableRoles().map(r=>`<option value="${r[0]}">${r[1]}</option>`).join('')}</select></div><button class="btn primary">Create user</button></form></div>`;document.body.appendChild(m);m.querySelector('[data-close]').onclick=()=>m.remove();m.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await api('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});m.remove();toast('User created.');loadUsers();}catch(err){toast(err.message)}};}
function openAccessModal(user){const m=document.createElement('div');m.className='modal-backdrop';m.innerHTML=`<div class="modal"><div class="modal-head"><div><div class="eyebrow">Business assignment</div><h3>${esc(user?.displayName||user?.username||'User')}</h3></div><button class="close" data-close>×</button></div><form class="form-stack" style="margin-top:20px"><p class="small">Select the business units this user may access.</p>${state.businesses.map(b=>`<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="businessIds" value="${esc(b.id)}" ${Array.isArray(user?.businessIds)&&user.businessIds.includes(b.id)?'checked':''}>${esc(b.name)}</label>`).join('')}<button class="btn primary">Save access</button></form></div>`;document.body.appendChild(m);m.querySelector('[data-close]').onclick=()=>m.remove();m.querySelector('form').onsubmit=async e=>{e.preventDefault();const businessIds=[...m.querySelectorAll('input[name="businessIds"]:checked')].map(x=>x.value);try{await api(`/api/users/${encodeURIComponent(user.id)}/business-access`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessIds})});m.remove();toast('Business access updated.');}catch(err){toast(err.message)}};}

async function openRolePermissions(){
  if(!canManageRoles()){toast('You do not have permission to manage roles.');return;}
  const allRoles=[['owner','Owner'],['general_manager','General Manager'],['accountant','Accountant'],['business_manager','Business Manager'],['viewer','Viewer']];
  const roles=allRoles.filter(([value])=>canEditRole(value));
  if(!roles.length){toast('There are no other roles you can modify.');return;}
  const m=document.createElement('div');m.className='modal-backdrop';m.innerHTML=`<div class="modal" style="max-width:760px"><div class="modal-head"><div><div class="eyebrow">Access management</div><h3>Role permissions</h3></div><button class="close" data-close>×</button></div><div class="field"><label>Role</label><select class="input" id="permissionRole">${roles.map(r=>`<option value="${r[0]}">${r[1]}</option>`).join('')}</select></div><div id="permissionList" class="form-stack" style="margin-top:16px">Loading…</div><button class="btn primary" id="savePermissions" style="margin-top:16px">Save permissions</button></div>`;
  document.body.appendChild(m);m.querySelector('[data-close]').onclick=()=>m.remove();
  const load=async()=>{const role=m.querySelector('#permissionRole').value;const d=await api('/api/permissions/'+role);m.querySelector('#permissionList').innerHTML=(d.permissions||[]).map(p=>`<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-permission="${esc(p.key)}" ${p.enabled?'checked':''}>${esc(p.label)}</label>`).join('');};
  m.querySelector('#permissionRole').onchange=()=>load();
  m.querySelector('#savePermissions').onclick=async()=>{const role=m.querySelector('#permissionRole').value;const permissions=[...m.querySelectorAll('[data-permission]:checked')].map(x=>x.dataset.permission);try{await api('/api/permissions/'+role,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissions})});toast('Role permissions saved.');m.remove();}catch(err){toast(err.message)}};
  try{await load();}catch(err){m.querySelector('#permissionList').innerHTML=`<div class="notice error">${esc(err.message)}</div>`;}
}


