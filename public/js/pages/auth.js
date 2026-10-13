import {api,loadPublicBranding} from '../api.js';
import {state,$,esc} from '../state.js';
import {logo,toast} from '../components/ui.js';
import {legalDocuments,legalModal} from './legal.js';

const CURRENCIES = [
  ['NGN','Nigerian Naira','₦'],
  ['USD','United States Dollar','$'],
  ['GBP','British Pound Sterling','£'],
  ['EUR','Euro','€'],
  ['GHS','Ghanaian Cedi','₵'],
  ['KES','Kenyan Shilling','KSh'],
  ['ZAR','South African Rand','R'],
  ['CAD','Canadian Dollar','$'],
  ['AUD','Australian Dollar','$'],
  ['CHF','Swiss Franc','CHF'],
  ['CNY','Chinese Yuan','¥'],
  ['INR','Indian Rupee','₹'],
  ['AED','United Arab Emirates Dirham','د.إ'],
  ['SAR','Saudi Riyal','﷼'],
  ['XOF','West African CFA Franc','CFA'],
  ['XAF','Central African CFA Franc','FCFA']
];
const currencyOptions = selected => CURRENCIES.map(([code,name,symbol]) => `<option value="${code}" ${selected===code?'selected':''}>${code} — ${name} (${symbol})</option>`).join('');
const currencyLabel = code => { const c=CURRENCIES.find(([value])=>value===code); return c ? `${c[0]} — ${c[1]} (${c[2]})` : code; };

export async function login(app,msg=''){try{await loadPublicBranding()}catch{}
  app.innerHTML=`<div class="auth-shell"><section class="auth-art"><div class="auth-brand">REPORT<span>GEN</span></div><div class="art-bottom"><div class="eyebrow">Business intelligence platform</div><h1>Know your business.<br>Report with confidence.</h1><p>Bring sales and financial records into one controlled workspace, turn raw exports into useful insight, and keep every number traceable.</p><div class="art-points"><div class="art-point"><b>01</b>Controlled data</div><div class="art-point"><b>02</b>Local & secure</div><div class="art-point"><b>03</b>Management ready</div></div></div></section><section class="auth-side"><div class="auth-card">${logo(null,'startup-logo').replace('startup-logo','')}<div class="eyebrow" style="margin-top:24px">${esc(state.company?.name||'REPORTGEN')}</div><h2>Welcome back.</h2><div class="sub">Sign in to your reporting workspace.</div>${msg?`<div class="notice error">${esc(msg)}</div>`:''}<form id="loginForm" class="form-stack" style="margin-top:20px"><div class="field"><label>Username</label><input class="input" name="username" autocomplete="username" placeholder="Enter username" required></div><div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password" placeholder="Enter password" required></div><button class="btn primary" type="submit" style="margin-top:5px">Sign in to ReportGen →</button></form><button id="forgotPassword" class="text-link" type="button">Forgot your password?</button><button id="themeToggle" class="btn ghost" style="margin-top:14px">${state.theme==='dark'?'☼ Use light theme':'◐ Use dark theme'}</button></div><button id="certificateLink" class="certificate-link" type="button" aria-label="Open secure connection setup" tabindex="-1"><span aria-hidden="true">⇩</span></button></section></div>`;
  $('#loginForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{const d=await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.get('username'),password:f.get('password')})});state.user=d.user;state.csrf=d.csrfToken;location.reload()}catch(err){login(app,err.message)}};
  $('#forgotPassword').onclick=()=>showPasswordRecovery(app);
  $('#certificateLink').addEventListener('dblclick',async()=>{
    const certificateUrl='/network/reportgen-local-ca.cer';
    try {
      const available=await fetch(certificateUrl,{method:'HEAD'});
      if(!available.ok){window.open('/network/secure-connection','_blank','noopener,noreferrer');return}
      const download=document.createElement('a');download.href=certificateUrl;download.download='reportgen-local-ca.cer';
      document.body.appendChild(download);download.click();download.remove();
    } catch { window.open('/network/secure-connection','_blank','noopener,noreferrer'); }
  });
  $('#themeToggle').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem('reportgen-theme',state.theme);applyTheme();login(app)};
}

function showPasswordRecovery(app){const overlay=document.createElement('div');overlay.className='modal-backdrop';overlay.innerHTML=`<div class="modal-card recovery-modal"><button class="modal-close" id="closeRecovery" aria-label="Close">×</button><div class="eyebrow">PASSWORD RECOVERY</div><h3>Forgot your password?</h3><p class="small">ReportGen is designed for local/on-premise use, so password recovery is performed on the server computer to protect your financial workspace.</p><div class="recovery-steps"><div><b>01</b><span>Open the ReportGen folder on the server computer.</span></div><div><b>02</b><span>Double-click <strong>reset-admin-password.bat</strong>.</span></div><div><b>03</b><span>Enter your username and create a new password.</span></div><div><b>04</b><span>Return here and sign in with the new password.</span></div></div><div class="notice">This keeps your company, businesses and imported data. It only changes the selected user's password and invalidates existing sessions.</div><button class="btn primary" id="closeRecoveryBtn">Back to sign in</button></div>`;document.body.appendChild(overlay);const close=()=>overlay.remove();overlay.querySelector('#closeRecovery').onclick=close;overlay.querySelector('#closeRecoveryBtn').onclick=close;overlay.addEventListener('click',e=>{if(e.target===overlay)close()})}
export function applyTheme(){document.documentElement.dataset.theme=state.theme}

export async function setup(app){
  let step=1;let docs=null;
  try{docs=await legalDocuments()}catch{docs={version:'2026-09-19',documents:{}}}
  const values={companyName:'',address:'',phone:'',email:'',currency:'NGN',logoDataUrl:'',adminDisplayName:'',adminUsername:'',adminPassword:'',acceptTerms:false,acceptPrivacy:false,acceptDisclaimer:false,acceptAcceptableUse:false};
  const draw=()=>{const steps=['Company','Legal','Administrator','Review','Initialize'];app.innerHTML=`<button class="theme-toggle" id="themeToggle">${state.theme==='dark'?'☼ Light':'◐ Dark'}</button><div class="setup-wrap"><div class="setup-card"><div class="setup-top"><div><div class="eyebrow">REPORTGEN · FIRST RUN</div><h1>Set up your workspace</h1><div class="small">Create your company workspace once. Everything else grows from here.</div></div>${logo(null,'')}</div><div class="steps">${steps.map((x,i)=>`<div class="step ${i+1===step?'active':''} ${i+1<step?'done':''}"><b>${i+1<step?'✓':String(i+1).padStart(2,'0')}</b>${x}</div>${i<4?'<span class="step-line"></span>':''}`).join('')}</div><div id="setupBody"></div></div></div>`;
    $('#themeToggle').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem('reportgen-theme',state.theme);applyTheme();draw()};
    const body=$('#setupBody');
    if(step===1)body.innerHTML=`<div class="brand-preview">${logo(null)}<div><strong>ReportGen workspace</strong><span>Your company identity will appear throughout the application and reports.</span></div></div><div class="setup-grid"><div class="field full"><label>Company name *</label><input class="input" id="companyName" value="${esc(values.companyName)}" placeholder="e.g. Example Company" required></div><div class="field full"><label>Company address</label><input class="input" id="address" value="${esc(values.address)}" placeholder="Business address"></div><div class="field"><label>Phone</label><input class="input" id="phone" value="${esc(values.phone)}" placeholder="Contact phone"></div><div class="field"><label>Email</label><input class="input" id="email" type="email" value="${esc(values.email)}" placeholder="company@example.com"></div><div class="field"><label>Base currency *</label><select class="select" id="currency">${currencyOptions(values.currency)}</select><div class="small">Used for the company's primary financial reporting.</div></div><div class="field"><label>Company logo</label><input class="input" id="logoFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"><div class="small">Optional. Maximum 2.5 MB.</div></div><div class="field full"><label>Workspace</label><div class="small" style="padding:12px 0">Local/on-premise by default. The server remains the source of truth.</div></div></div><div class="setup-footer"><span class="small">You can refine company details later.</span><button class="btn primary" id="next">Continue →</button></div>`;
    else if(step===2)body.innerHTML=`<div class="legal-intro"><div class="eyebrow">LEGAL & RESPONSIBLE USE</div><h3>Review the documents before creating the workspace.</h3><p class="small">These documents explain how ReportGen handles workspace data, reporting responsibilities and acceptable use. You must acknowledge all four before setup can continue.</p></div><div class="legal-list">${[['terms','acceptTerms'],['privacy','acceptPrivacy'],['disclaimer','acceptDisclaimer'],['acceptableUse','acceptAcceptableUse']].map(([key,field])=>{const d=docs.documents?.[key]||{title:key,version:docs.version};return `<div class="legal-item"><div><strong>${esc(d.title)}</strong><span>Version ${esc(d.version)}</span></div><button class="btn" type="button" data-legal-doc="${key}">Read</button><label class="check"><input type="checkbox" id="${field}" ${values[field]?'checked':''}><span>I have read and agree to this document.</span></label></div>`}).join('')}</div><div class="setup-footer"><button class="btn" id="back">← Back</button><button class="btn primary" id="next">Continue →</button></div>`;
    else if(step===3)body.innerHTML=`<div class="setup-grid"><div class="field full"><label>Administrator display name *</label><input class="input" id="adminDisplayName" value="${esc(values.adminDisplayName)}" placeholder="e.g. Amos Balami"></div><div class="field"><label>Username *</label><input class="input" id="adminUsername" value="${esc(values.adminUsername)}" placeholder="admin"></div><div class="field"><label>Password *</label><input class="input" id="adminPassword" type="password" value="${esc(values.adminPassword)}" placeholder="At least 8 characters"></div></div><div class="setup-footer"><button class="btn" id="back">← Back</button><button class="btn primary" id="next">Continue →</button></div>`;
    else if(step===4)body.innerHTML=`<div class="brand-preview">${logo(null)}<div><strong>${esc(values.companyName||'—')}</strong><span>Base currency: ${esc(currencyLabel(values.currency))} · Administrator: ${esc(values.adminDisplayName||'—')}</span></div></div><div class="review-grid"><div><span>Legal</span><strong>All four acknowledgements required</strong></div><div><span>Workspace</span><strong>Local server + SQLite</strong></div><div><span>Administrator</span><strong>${esc(values.adminUsername||'—')}</strong></div></div><div class="legal"><div class="eyebrow">Workspace confirmation</div><h3>Ready to create your workspace?</h3><p class="small">ReportGen will initialize the company workspace, administrator account and legal acceptance record.</p><label class="check"><input type="checkbox" id="confirmSetup"> <span>I confirm that these details are correct.</span></label></div><div class="setup-footer"><button class="btn" id="back">← Back</button><button class="btn primary" id="next">Create workspace →</button></div>`;
    else body.innerHTML=`<div class="init">${logo(null,'init-logo')}<div class="eyebrow">INITIALIZATION COMPLETE</div><h2 style="font-family:Montserrat">Workspace ready</h2><p class="small">Your local ReportGen environment is initialized. You can now sign in.</p><button class="btn primary" id="finish">Continue to sign in →</button></div>`;

    $('#logoFile')?.addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>2500000){e.target.value='';return toast('Logo is larger than 2.5 MB.');}const reader=new FileReader();reader.onload=()=>{values.logoDataUrl=String(reader.result||'');};reader.readAsDataURL(file);});
    document.querySelectorAll('[data-legal-doc]').forEach(b=>b.onclick=()=>{const d=docs.documents?.[b.dataset.legalDoc];if(d)legalModal(d)});
    if($('#next'))$('#next').onclick=async()=>{
      if(step===1){values.companyName=$('#companyName').value.trim();values.address=$('#address').value.trim();values.phone=$('#phone').value.trim();values.email=$('#email').value.trim();values.currency=$('#currency').value||'NGN';if(values.companyName.length<2)return toast('Enter a company name.');if(values.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))return toast('Enter a valid company email.');step=2;draw()}
      else if(step===2){values.acceptTerms=$('#acceptTerms').checked;values.acceptPrivacy=$('#acceptPrivacy').checked;values.acceptDisclaimer=$('#acceptDisclaimer').checked;values.acceptAcceptableUse=$('#acceptAcceptableUse').checked;if(!values.acceptTerms||!values.acceptPrivacy||!values.acceptDisclaimer||!values.acceptAcceptableUse)return toast('Review and acknowledge all four legal documents.');step=3;draw()}
      else if(step===3){values.adminDisplayName=$('#adminDisplayName').value.trim();values.adminUsername=$('#adminUsername').value.trim();values.adminPassword=$('#adminPassword').value;if(values.adminDisplayName.length<2||values.adminUsername.length<3||values.adminPassword.length<8)return toast('Complete the administrator fields.');step=4;draw()}
      else {if(!$('#confirmSetup').checked)return toast('Confirm the workspace details first.');try{await api('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});step=5;draw()}catch(err){toast(err.message)}}
    };
    if($('#back'))$('#back').onclick=()=>{step--;draw()};
    if($('#finish'))$('#finish').onclick=()=>login(app,'Workspace created. Sign in with your administrator account.');
  };
  draw();
}
