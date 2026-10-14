import {state,esc,initials,can,normalizedRole} from '../state.js';

let activeLoads=0;
let loadingTimer=null;
const loadingLabels={
  '/api/auth/login':'Signing you in…',
  '/api/auth/logout':'Signing you out…',
  '/api/sales/inspect':'Inspecting your file…',
  '/api/sales/imports':'Importing sales data…',
  '/api/company':'Saving company profile…',
  '/api/businesses':'Saving business…',
  '/api/setup/initialize':'Initializing workspace…',
  '/api/setup/status':'Checking workspace…',
  '/api/auth/me':'Restoring your session…',
  '/api/public/branding':'Loading company branding…'
};
function ensureLoadingOverlay(){
  let el=document.getElementById('rg-loading-overlay');
  if(el)return el;
  el=document.createElement('div');
  el.id='rg-loading-overlay';
  el.className='rg-loading-overlay';
  el.setAttribute('aria-live','polite');
  el.setAttribute('aria-busy','true');
  el.innerHTML='<div class="rg-loading-card" role="status"><span class="rg-spinner" aria-hidden="true"></span><div><strong id="rg-loading-title">Please wait…</strong><span id="rg-loading-detail">Working on your request.</span></div></div>';
  document.body.appendChild(el);
  return el;
}
export function beginLoading(message='Please wait…'){
  activeLoads+=1;
  const el=ensureLoadingOverlay();
  const title=el.querySelector('#rg-loading-title');
  const detail=el.querySelector('#rg-loading-detail');
  if(title)title.textContent=message;
  if(detail)detail.textContent='Please wait while ReportGen completes this process.';
  el.classList.add('visible');
  if(loadingTimer)clearTimeout(loadingTimer);
  loadingTimer=setTimeout(()=>{if(activeLoads>0)el.classList.add('slow')},7000);
}
export async function runWithLoading(message,work,minDuration=180){
  const started=Date.now();
  window.__reportgenRuntimeLoading=true;
  beginLoading(message);
  try{return await work();}
  finally{
    const wait=Math.max(0,minDuration-(Date.now()-started));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    endLoading();
    window.__reportgenRuntimeLoading=false;
  }
}
export function endLoading(){
  activeLoads=Math.max(0,activeLoads-1);
  if(activeLoads===0){
    const el=document.getElementById('rg-loading-overlay');
    if(el)el.classList.remove('visible','slow');
    if(loadingTimer)clearTimeout(loadingTimer);
    loadingTimer=null;
  }
}
export function loadingLabel(url,method='GET'){
  if(loadingLabels[url])return loadingLabels[url];
  if(method==='GET'){
    if(url.includes('/api/dashboard/summary'))return 'Loading dashboard data…';
    if(url.includes('/api/sales/summary'))return 'Loading sales data…';
    if(url.includes('/api/businesses'))return 'Loading businesses…';
    if(url.includes('/api/owner/expense-summary'))return 'Loading expense allocation…';
    if(url.includes('/api/payroll'))return 'Loading payroll…';
    if(url.includes('/api/staff'))return 'Loading staff records…';
    if(url.includes('/api/capital'))return 'Loading purchase data…';
    if(url.includes('/api/reports'))return 'Preparing report…';
    if(url.includes('/api/messages'))return 'Loading messages…';
    if(url.includes('/api/users'))return 'Loading users…';
    return 'Loading workspace…';
  }
  if(method==='PATCH')return 'Saving changes…';
  if(method==='POST')return 'Processing request…';
  if(method==='DELETE')return 'Removing item…';
  return 'Please wait…';
}
export function logo(src=null,cls=''){const resolved=src||state.company?.logoDataUrl||'/assets/reportgen-logo.png';return `<img class="${cls}" data-brand-logo="1" src="${esc(resolved)}" alt="">`}
if(!window.__reportgenLogoFallbackBound){window.__reportgenLogoFallbackBound=true;document.addEventListener('error',event=>{const image=event.target;if(!(image instanceof HTMLImageElement)||image.dataset.brandLogo!=='1'||image.dataset.fallback==='1')return;image.dataset.fallback='1';image.src='/assets/reportgen-logo.png';},true);}
export function toast(message){const root=document.getElementById('toast-root');const x=document.createElement('div');x.className='toast';x.textContent=message;root.appendChild(x);setTimeout(()=>x.remove(),3500)}
export function modal(title,body,actions=''){const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal modal-scroll" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">ReportGen</div><h3>${esc(title)}</h3></div><button class="close" data-close aria-label="Close">×</button></div><div class="modal-content">${body}</div>${actions?`<div class="modal-actions">${actions}</div>`:''}</div>`;document.body.appendChild(wrap);wrap.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>wrap.remove()));wrap.addEventListener('click',event=>{if(event.target===wrap)wrap.remove()});return wrap}
export const roleLabel=role=>({admin:'Administrator',administrator:'Administrator',owner:'Owner',general_manager:'General Manager',accountant:'Accountant',business_manager:'Business Manager',manager:'Manager',staff:'Staff',viewer:'Viewer'}[normalizedRole(role)]||String(role||'User').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()));
export const workspaceLabel=()=>`${roleLabel(state.user?.role)} workspace`;
export function isAccountant(){return normalizedRole(state.user?.role)==='accountant';}
export function canManageAdmin(){return ['owner','general_manager','administrator','admin'].includes(normalizedRole(state.user?.role));}
export function canDeleteImports(){return canManageAdmin();}
export function sidebar(){const overview=[['dashboard','⌂','Dashboard','dashboard.view']];const ops=[['businesses','▦','Businesses','businesses.view'],['sales','↥','Sales','sales.view'],['staff','♙','Staff Management','staff.view'],['expenses','◈','Expenses','expenses.view'],...((normalizedRole(state.user?.role)==='accountant'||can('shared_expenses.view'))&&can('shared_expenses.view')?[['shared-expenses','⇄','Shared Expenses','shared_expenses.view']]:[]),...((normalizedRole(state.user?.role)==='accountant'||can('external_businesses.view'))&&can('external_businesses.view')?[['external-businesses','▧','External Businesses','external_businesses.view']]:[]),['purchases','◇','Purchases','capital.view'],['vendor-payments','₦','Vendor Payments','vendor_payments.view'],['payroll','◌','Payroll','payroll.view'],['deductions','₦','Staff Deductions','payroll.deductions']].filter(x=>can(x[3]));const analysis=[['comparison','⇄','Company Comparison','comparison.view']].filter(x=>can(x[3]));const reporting=[['reports','▤','Reports','reports.view'],...(normalizedRole(state.user?.role)==='owner'?[['general-company-report','▧','General Company Report','dashboard.view']]:[])].filter(x=>can(x[3]));const communication=[['messages','✉','Messages','messages.send']].filter(x=>can(x[3]));const history=can('history.view')?'<button data-page="history"><span class="icon">◫</span><span>Import History</span></button>':'';return `<div class="nav-backdrop" id="navBackdrop"></div><aside class="sidebar" id="appSidebar"><div class="company-card">${logo()}<div><strong>${esc(state.company?.name||'Your Company')}</strong><span>${esc(workspaceLabel())}</span></div></div><div class="sidebar-scroll"><div class="nav-title">Overview</div><nav class="nav">${overview.filter(x=>can(x[3])).map(x=>navButton(...x.slice(0,3))).join('')}</nav><div class="nav-title">Operations</div><nav class="nav">${ops.map(x=>navButton(...x.slice(0,3))).join('')}</nav><div class="nav-title">Analysis</div><nav class="nav">${analysis.map(x=>navButton(...x.slice(0,3))).join('')}</nav><div class="nav-title">Reporting</div><nav class="nav">${reporting.map(x=>navButton(...x.slice(0,3))).join('')}</nav><div class="nav-title">Communication</div><nav class="nav">${communication.map(x=>navButton(...x.slice(0,3))).join('')}</nav></div><div class="sidebar-bottom"><div class="server-pill"><span class="dot"></span><span>Local server connected</span></div><nav class="nav">${history}${can('settings.manage')?'<button data-page="settings"><span class="icon">⚙</span><span>Settings</span></button>':''}${can('users.manage')?'<button data-page="users"><span class="icon">♙</span><span>Users & Access</span></button>':''}${can('audit.view')?'<button data-page="audit"><span class="icon">◉</span><span>Audit Log</span></button>':''}</nav><button id="logout" class="btn ghost" style="width:100%;margin-top:8px">Sign out</button></div></aside>`}
function navButton(id,ic,t){return `<button data-page="${id}" class="${state.page===id?'active':''}"><span class="icon">${ic}</span><span>${t}</span></button>`}

export function topbar(title){return `<header class="topbar"><h1>${esc(title)}</h1><div class="topbar-right"><label class="global-month-picker"><span>Reporting month</span><input id="globalMonth" class="input global-month-select" type="month" value="${esc(state.dashboardMonth)}" aria-label="Reporting month"></label><button class="btn ghost" id="themeToggle" aria-label="Switch to ${state.theme==='dark'?'light':'dark'} theme"><span class="theme-icon" aria-hidden="true">${state.theme==='dark'?'☼':'◐'}</span><span class="theme-label"> ${state.theme==='dark'?'Light':'Dark'}</span></button><div class="user-chip" role="button" tabindex="0" title="Account security"><span class="avatar">${esc(initials(state.user?.displayName||state.user?.username))}</span><span class="user-meta"><strong>${esc(state.user?.displayName||state.user?.username||'')}</strong><span>${esc(roleLabel(state.user?.role))}</span></span></div><button class="btn ghost mobile-nav-toggle" id="mobileNavToggle" aria-label="Open navigation menu" aria-expanded="false">☰<span class="sr-only">Menu</span></button></div></header>`}
export function pageShell(title,body){const shellClass=title==='General Company Report'?'shell general-company-report-shell':'shell';return `<div class="${shellClass}">${sidebar()}<main class="main">${topbar(title)}<section class="content">${body}</section></main></div>`}
