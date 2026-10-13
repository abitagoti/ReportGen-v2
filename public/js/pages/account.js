import {state,esc} from '../state.js';
import {api} from '../api.js';
import {toast} from '../components/ui.js';

export function openAccountSecurity(){
  const m=document.createElement('div');
  m.className='modal-backdrop';
  m.innerHTML=`<div class="modal" style="max-width:560px"><div class="modal-head"><div><div class="eyebrow">ACCOUNT SECURITY</div><h3>Change password</h3><p class="small">Signed in as ${esc(state.user?.displayName||state.user?.username||'User')}.</p></div><button class="close" data-close aria-label="Close">×</button></div><form id="changePasswordForm" class="form-stack" style="margin-top:18px"><div class="field"><label>Current password</label><input class="input" name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label>New password</label><input class="input" name="newPassword" type="password" autocomplete="new-password" minlength="8" required><span class="small">Use at least 8 characters.</span></div><div class="field"><label>Confirm new password</label><input class="input" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></div><div class="notice">Changing your password signs out all active sessions. You will be asked to sign in again.</div><button class="btn primary" type="submit">Change password</button></form></div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.querySelector('[data-close]').onclick=close;
  m.addEventListener('click',e=>{if(e.target===m)close()});
  m.querySelector('#changePasswordForm').onsubmit=async e=>{
    e.preventDefault();
    const data=Object.fromEntries(new FormData(e.target).entries());
    try{
      await api('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),loadingMessage:'Changing password…'});
      close();
      toast('Password changed. Please sign in again.');
      state.user=null;state.csrf=null;
      setTimeout(()=>location.reload(),250);
    }catch(err){toast(err.message)}
  };
}
