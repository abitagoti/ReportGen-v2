import {state,$,esc,can} from '../state.js';
import {api} from '../api.js';
import {pageShell,toast,beginLoading,endLoading} from '../components/ui.js';

export function settings(){
  if(!can('settings.manage'))
    return pageShell('Dashboard','<div class="notice error">You do not have permission to access Settings.</div>');
  const c=state.company||{};
  const cards=[
    ['company','Company profile','Company identity, contact details, staff ID prefix and logo.','Less sensitive','building-2'],
    ['appearance','Appearance','Theme and browser display preferences.','Less sensitive','palette'],
    ['status','Workspace status','Connection, data-store and account information.','Informational','activity'],
    ['organization','Organization setup','Departments and job roles used across staff records.','Operational','layers'],
    ['network','Network & deployment','Server binding, port, LAN addresses and deployment diagnostics.','Sensitive','network'],
    ['database','Database backup & restore','Verified database backups, exports and database imports.','Most sensitive','database']
  ];
  const cardHtml=cards.map(([id,title,description,level,icon])=>`<button type="button" class="settings-card" data-settings-open="${id}"><span class="settings-card-icon"><i data-lucide="${icon}"></i></span><span class="settings-card-copy"><strong>${title}</strong><span>${description}</span><small>${level}</small></span><span class="settings-card-arrow">↗</span></button>`).join('');
  const html=pageShell('Settings',`<div class="page-intro"><div><div class="eyebrow">SYSTEM</div><h2>Workspace settings</h2><p>Settings are grouped into cards and ordered from general preferences to the most sensitive controls.</p></div></div>
  <div class="settings-card-grid">${cardHtml}</div>
  <div class="settings-modal-backdrop" id="settingsModal" hidden>
    <div class="modal modal-scroll settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle">
      <div class="modal-head"><div><div class="eyebrow">WORKSPACE SETTINGS</div><h3 id="settingsModalTitle">Settings</h3><p id="settingsModalDescription" class="small"></p></div><button class="close" type="button" id="closeSettingsModal" aria-label="Close settings">×</button></div>
      <div class="modal-content settings-modal-content">
        <section class="settings-panel" data-settings-panel="company">
          <div class="panel-head"><div><h3>Company profile</h3><p>This identity appears across the workspace and future reports.</p></div></div>
          <form id="companyForm" class="setup-grid">
            <div class="field full"><label>Company name *</label><input class="input" name="name" value="${esc(c.name)}" required></div>
            <div class="field"><label>Currency *</label><input class="input" name="currency" value="${esc(c.currency||'NGN')}" required></div>
            <div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(c.phone||'')}" placeholder="Company phone"></div>
            <div class="field full"><label>Email</label><input class="input" name="email" value="${esc(c.email||'')}" type="email" placeholder="company@example.com"></div>
            <div class="field full"><label>Address</label><textarea class="textarea" name="address" placeholder="Company address">${esc(c.address||'')}</textarea></div>
            <div class="field"><label>Staff ID prefix *</label><input class="input" name="staffIdPrefix" value="${esc(c.staffIdPrefix||'STF')}" maxlength="12" pattern="[A-Za-z0-9-]{2,12}" required><div class="small">New staff IDs will look like PREFIX-0001.</div></div>
            <div class="field"><label>Company logo</label><input class="input" id="logoFile" type="file" accept="image/png,image/jpeg,image/webp"><div class="small">Use a clean PNG/JPG/WebP. Maximum 2.5 MB.</div></div>
            <div class="field full"><div class="brand-preview"><img id="settingsLogo" src="${esc(c.logoDataUrl||'/assets/reportgen-logo.png')}" data-brand-logo="1"><div><strong>Workspace identity</strong><span>Preview of the company mark used by ReportGen.</span></div></div></div>
            <div class="field full" style="display:flex;justify-content:flex-end"><button class="btn primary" type="submit">Save company profile</button></div>
          </form>
        </section>
        <section class="settings-panel" data-settings-panel="appearance">
          <div class="panel-head"><div><h3>Appearance</h3><p>Choose the workspace theme for this browser.</p></div></div>
          <div class="theme-options"><button class="theme-option ${state.theme==='light'?'active':''}" data-theme-choice="light"><strong>Light</strong><span>Clean management workspace</span></button><button class="theme-option ${state.theme==='dark'?'active':''}" data-theme-choice="dark"><strong>Dark</strong><span>Low-light premium workspace</span></button></div>
        </section>
        <section class="settings-panel" data-settings-panel="status">
          <div class="panel-head"><div><h3>Workspace status</h3><p>Core environment information.</p></div></div>
          <div class="mini-list"><div class="mini-row"><div><strong>Server</strong><span>Local ReportGen server</span></div><span class="pill success">Connected</span></div><div class="mini-row"><div><strong>Data store</strong><span>SQLite · server source of truth</span></div><span class="pill success">Ready</span></div><div class="mini-row"><div><strong>Account</strong><span>${esc(state.user?.displayName||state.user?.username||'')}</span></div><span class="pill">${esc(state.user?.role||'')}</span></div></div>
        </section>
        <section class="settings-panel" data-settings-panel="organization">
          <div class="panel-head"><div><h3>Organization setup</h3><p>Create the departments and job roles used when creating staff. Existing staff records are retained.</p></div></div>
          <div id="organizationNotice" class="notice success" style="display:none;margin-bottom:12px"></div><div class="settings-grid settings-two-col"><div><h4>Departments</h4><form id="departmentForm" class="button-row"><input class="input" name="name" placeholder="Department name" required><button class="btn primary">Add department</button></form><div id="departmentsList" class="mini-list"><div class="small">Loading departments…</div></div></div><div><h4>Job roles</h4><form id="jobRoleForm" class="button-row"><input class="input" name="name" placeholder="Job role name" required><select class="select" name="departmentId"><option value="">No department</option></select><button class="btn primary">Add role</button></form><div id="jobRolesList" class="mini-list"><div class="small">Loading job roles…</div></div></div></div>
        </section>
        <section class="settings-panel" data-settings-panel="network">
          <div class="panel-head"><div><h3>Network & deployment</h3><p>Read-only server configuration and LAN diagnostics. Change sensitive deployment values on the server.</p></div></div>
          <div id="networkConfigPanel" class="mini-list"><div class="mini-row"><div><strong>Loading configuration</strong><span>Checking server network settings…</span></div><span class="pill">Checking</span></div></div>
        </section>
        <section class="settings-panel" data-settings-panel="database">
          <div class="panel-head"><div><h3>Database backup & restore</h3><p>Create a verified backup or import a previously exported ReportGen database. Import is staged and requires a server restart.</p></div></div>
          <div class="settings-grid settings-two-col"><div class="mini-list"><div class="mini-row"><div><strong>Backup database</strong><span>Save a verified SQLite copy with a checksum.</span></div><button class="btn primary" id="backupDatabaseBtn" type="button">Backup now</button></div><div class="mini-row"><div><strong>Export database</strong><span>Download a verified backup file to your computer.</span></div><button class="btn" id="exportDatabaseBtn" type="button">Export</button></div></div><div class="mini-list"><div class="mini-row"><div><strong>Import database</strong><span>Validate a backup and stage it for the next server start.</span></div><label class="btn" for="importDatabaseFile">Choose backup</label><input id="importDatabaseFile" type="file" accept=".sqlite,.db,.sqlite3" hidden></div><div id="databaseBackupStatus" class="small">Loading backup history…</div></div></div>
          <div class="table-wrap"><table><thead><tr><th>Backup</th><th>Size</th><th>Created</th><th>Verification</th><th>Action</th></tr></thead><tbody id="databaseBackupHistory"><tr><td colspan="5">Loading…</td></tr></tbody></table></div>
        </section>
      </div>
    </div>
  </div>`);
  setTimeout(bindSettings,0);
  return html;
}
function bindSettings(){
  const form=$('#companyForm');
  if(!form)return;
  const settingsMeta={
    company:['Company profile','Company identity and staff numbering.'],
    appearance:['Appearance','Theme and browser display preferences.'],
    status:['Workspace status','Connection and account information.'],
    organization:['Organization setup','Departments and job roles.'],
    network:['Network & deployment','Server and LAN diagnostics.'],
    database:['Database backup & restore','Backups, exports and database imports.']
  };
  const modal=$('#settingsModal');
  const title=$('#settingsModalTitle');
  const description=$('#settingsModalDescription');
  const closeSettings=()=>{if(modal){modal.hidden=true;document.body.classList.remove('modal-open')}};
  document.querySelectorAll('[data-settings-open]').forEach(card=>card.addEventListener('click',()=>{
    const id=card.dataset.settingsOpen;
    document.querySelectorAll('[data-settings-panel]').forEach(panel=>{panel.hidden=panel.dataset.settingsPanel!==id});
    const meta=settingsMeta[id]||['Settings',''];
    if(title)title.textContent=meta[0];
    if(description)description.textContent=meta[1];
    if(modal){modal.hidden=false;document.body.classList.add('modal-open');modal.querySelector('.settings-modal')?.scrollTo(0,0);}
  }));
  $('#closeSettingsModal')?.addEventListener('click',closeSettings);
  modal?.addEventListener('click',e=>{if(e.target===modal)closeSettings()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal&&!modal.hidden)closeSettings()},{once:true});
  document.querySelector('[data-settings-open="company"]')?.click();
  closeSettings();
  let logoDataUrl=state.company?.logoDataUrl||'';
  $('#logoFile')?.addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>2_500_000){toast('Logo is larger than 2.5 MB.');e.target.value='';return;}const reader=new FileReader();beginLoading('Preparing company logo…');reader.onload=()=>{logoDataUrl=String(reader.result||'');$('#settingsLogo').src=logoDataUrl;endLoading()};reader.onerror=()=>{endLoading();toast('Unable to read the selected logo.')};reader.readAsDataURL(file)});
  form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);try{await api('/api/company',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.get('name'),currency:f.get('currency'),phone:f.get('phone'),email:f.get('email'),address:f.get('address'),staffIdPrefix:f.get('staffIdPrefix'),logoDataUrl})});const c=await api('/api/company');state.company=c.company;toast('Company profile saved.');location.reload()}catch(err){toast(err.message)}};
  document.querySelectorAll('[data-theme-choice]').forEach(b=>b.onclick=()=>{state.theme=b.dataset.themeChoice;localStorage.setItem('reportgen-theme',state.theme);document.documentElement.dataset.theme=state.theme;location.reload()});
  loadNetworkConfiguration();
  loadDatabaseBackup();
  loadOrganizationSetup();
}


async function loadDatabaseBackup(){
  const status=$('#databaseBackupStatus'), history=$('#databaseBackupHistory');
  if(!status||!history)return;
  const setStatus=(message,error=false)=>{status.textContent=message;status.className=error?'small notice error':'small';};
  const sizeLabel=value=>{const bytes=Number(value||0);return bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GB`:bytes>=1024**2?`${(bytes/1024**2).toFixed(1)} MB`:`${Math.ceil(bytes/1024)} KB`;};
  const renderHistory=(items=[])=>{
    history.innerHTML=items.length?items.slice(0,12).map(x=>`<tr><td>${esc(x.filename)}</td><td>${sizeLabel(x.size)}</td><td>${esc(new Date(x.createdAt).toLocaleString())}</td><td>${x.manifestValid?'Verified':'Needs verification'}</td><td><button type="button" class="btn" data-verify-backup="${esc(x.filename)}">Verify</button></td></tr>`).join(''):'<tr><td colspan="5">No backups created yet.</td></tr>';
    history.querySelectorAll('[data-verify-backup]').forEach(button=>button.onclick=async()=>{setStatus('Verifying backup…');try{const out=await api(`/api/database/backups/${encodeURIComponent(button.dataset.verifyBackup)}/verify`);button.textContent='Verified';button.disabled=true;setStatus(`Backup verified: ${out.checksum}`);}catch(error){button.textContent='Failed';setStatus(error.message||'Backup verification failed.',true);}});
  };
  try{const out=await api('/api/database/backups');renderHistory(out.backups||[]);setStatus('Backups are stored in the server data directory.');}catch(error){setStatus(error.message||'Unable to load backup history.',true);}
  $('#backupDatabaseBtn')?.addEventListener('click',async()=>{
    setStatus('Creating verified backup…');
    try{const out=await api('/api/database/backup-now',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});setStatus(`Backup created: ${out.filename}`);const h=await api('/api/database/backups');renderHistory(h.backups||[]);}catch(error){setStatus(error.message||'Backup failed.',true);}
  });
  $('#exportDatabaseBtn')?.addEventListener('click',async()=>{
    setStatus('Preparing database export…');
    try{
      const response=await fetch('/api/database/export',{headers:{'x-csrf-token':state.csrf||''}});
      if(!response.ok){let data={};try{data=await response.json()}catch{}throw new Error(data.error||`Export failed (${response.status})`);}
      const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='reportgen-backup.sqlite';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);setStatus('Database export downloaded.');
    }catch(error){setStatus(error.message||'Export failed.',true);}
  });
  $('#importDatabaseFile')?.addEventListener('change',async(event)=>{
    const file=event.target.files?.[0];if(!file)return;
    if(!confirm('Importing a database will stage it for the next server restart. A safety backup will be created first. Continue?')){event.target.value='';return;}
    setStatus('Uploading database backup… 0%');
    try{
      const out=await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/database/import');xhr.timeout=30*60*1000;xhr.setRequestHeader('x-csrf-token',state.csrf||'');xhr.upload.onprogress=event=>{if(event.lengthComputable)setStatus(`Uploading database backup… ${Math.floor(event.loaded/event.total*100)}%`)};xhr.upload.onload=()=>setStatus('Upload complete. Checking database integrity and creating a safety backup…');xhr.onerror=()=>reject(new Error('Database upload failed. Check the network connection and available disk space.'));xhr.ontimeout=()=>reject(new Error('Database upload took longer than 30 minutes. The existing database was not replaced.'));xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText)}catch{}if(xhr.status<200||xhr.status>=300||!data.ok)return reject(new Error(data.error||`Database import failed (${xhr.status}).`));resolve(data)};const body=new FormData();body.append('file',file,file.name);xhr.send(body)});
      setStatus(`Database import staged (${sizeLabel(out.size)}). A verified safety backup was created. Restart the ReportGen server to load the restored database.`);
    }catch(error){setStatus(error.message||'Import failed.',true);}
    finally{event.target.value='';}
  });
}

async function loadNetworkConfiguration(){
  const panel=$('#networkConfigPanel');
  if(!panel)return;
  try{
    const data=await api('/api/settings/configuration');
    const c=data.configuration||{};
    const addresses=(c.lanAddresses||[]).map(x=>`<span>${esc(x.interface)} (${esc(x.address)}): ${esc(x.url)}</span>`).join('')||'<span>No non-loopback IPv4 address detected.</span>';
    const browserUrl=c.browserUrl?`<div class="mini-row"><div><strong>Open in a browser</strong><span>${esc(c.browserUrl)}</span></div><span class="pill success">Use this address</span></div>`:'';
    const appPortNote=c.reverseProxy?'Internal only; use the browser address below.':'Direct browser port';
    const httpsNote=c.httpsEnabled?'Use the hostname for HTTPS so it matches the certificate.':'';
    panel.innerHTML=`<div class="mini-row"><div><strong>Public bind address</strong><span>${esc(c.host)}${c.reverseProxy?' (reverse proxy)':''}</span></div><span class="pill">${c.isLoopback?'Loopback':'LAN'}</span></div><div class="mini-row"><div><strong>${c.reverseProxy?'Internal application port':'Application port'}</strong><span>${esc(String(c.port))} · ${appPortNote}</span></div><span class="pill success">Active</span></div>${browserUrl}<div class="mini-row"><div><strong>HTTPS / reverse proxy</strong><span>${c.httpsEnabled?'HTTPS enabled':'HTTPS not enabled'} · ${c.reverseProxy?'Reverse proxy enabled':'Direct server mode'} ${httpsNote?`· ${httpsNote}`:''}</span></div><span class="pill">${esc(c.localHostname)}</span></div><div class="mini-row"><div><strong>LAN interfaces and browser addresses</strong>${addresses}</div></div>`;
  }catch(err){panel.innerHTML=`<div class="mini-row"><div><strong>Configuration unavailable</strong><span>${esc(err.message||'Unable to load network configuration.')}</span></div><span class="pill warn">Unavailable</span></div>`;}
}


async function loadOrganizationSetup(){
  const dl=$('#departmentsList'), rl=$('#jobRolesList'), ds=$('#jobRoleForm select[name="departmentId"]');
  if(!dl||!rl||!ds)return;
  try{
    const notice=()=>document.querySelector('#organizationNotice'); const showNotice=(message,error=false)=>{const n=notice();if(!n)return;n.textContent=message;n.className=`notice ${error?'error':'success'}`;n.style.display='block';}; const [d,r]=await Promise.all([api('/api/organization/departments'),api('/api/organization/job-roles')]);
    const departments=d.departments||[], roles=r.jobRoles||[];
    ds.innerHTML='<option value="">No department</option>'+departments.filter(x=>x.isActive).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    dl.innerHTML=departments.length?departments.map(x=>`<div class="mini-row"><div><strong>${esc(x.name)}</strong><span>${x.isActive?'Active':'Inactive'}</span></div><div class="button-row"><button class="btn" data-toggle-dept="${esc(x.id)}" data-active="${x.isActive?'1':'0'}">${x.isActive?'Deactivate':'Reactivate'}</button><button class="btn danger" data-delete-dept="${esc(x.id)}">Delete</button></div></div>`).join(''):'<div class="small">No departments created yet.</div>';
    rl.innerHTML=roles.length?roles.map(x=>`<div class="mini-row"><div><strong>${esc(x.name)}</strong><span>${esc(x.departmentName||'No department')} · ${x.isActive?'Active':'Inactive'}</span></div><div class="button-row"><button class="btn" data-toggle-role="${esc(x.id)}" data-active="${x.isActive?'1':'0'}">${x.isActive?'Deactivate':'Reactivate'}</button><button class="btn danger" data-delete-role="${esc(x.id)}">Delete</button></div></div>`).join(''):'<div class="small">No job roles created yet.</div>';
    document.querySelector('#departmentForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const name=new FormData(form).get('name');try{await api('/api/organization/departments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});form.reset();await loadOrganizationSetup();showNotice('Department created and the list was updated immediately.');toast('Department created.')}catch(err){showNotice(err.message,true);toast(err.message)}};
    document.querySelector('#jobRoleForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form);try{await api('/api/organization/job-roles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.get('name'),departmentId:f.get('departmentId')||null})});form.reset();await loadOrganizationSetup();showNotice('Job role created and the list was updated immediately.');toast('Job role created.')}catch(err){showNotice(err.message,true);toast(err.message)}};
    document.querySelectorAll('[data-toggle-dept]').forEach(b=>b.onclick=async()=>{try{const current=b.dataset.active==='1';await api('/api/organization/departments/'+b.dataset.toggleDept,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:b.parentElement.querySelector('strong').textContent,isActive:!current})});await loadOrganizationSetup()}catch(err){toast(err.message)}});
    document.querySelectorAll('[data-toggle-role]').forEach(b=>b.onclick=async()=>{try{const current=b.dataset.active==='1';await api('/api/organization/job-roles/'+b.dataset.toggleRole,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:b.parentElement.querySelector('strong').textContent,isActive:!current})});await loadOrganizationSetup()}catch(err){toast(err.message)}});
    document.querySelectorAll('[data-delete-dept]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this department? Related job roles will be kept without a department.'))return;try{await api('/api/organization/departments/'+encodeURIComponent(b.dataset.deleteDept),{method:'DELETE'});await loadOrganizationSetup();showNotice('Department deleted.')}catch(err){showNotice(err.message,true);toast(err.message)}});
    document.querySelectorAll('[data-delete-role]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this job role?'))return;try{await api('/api/organization/job-roles/'+encodeURIComponent(b.dataset.deleteRole),{method:'DELETE'});await loadOrganizationSetup();showNotice('Job role deleted.')}catch(err){showNotice(err.message,true);toast(err.message)}});
  }catch(err){dl.innerHTML=rl.innerHTML=`<div class="notice error">${esc(err.message)}</div>`;}
}
