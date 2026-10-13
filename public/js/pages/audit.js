import {state,esc,can,normalizedRole} from '../state.js';
import {api} from '../api.js';
import {pageShell,toast,runWithLoading} from '../components/ui.js';

const pageSize=50;
const todayISO=()=>new Date().toISOString().slice(0,10);
const daysAgoISO=days=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-days);return d.toISOString().slice(0,10)};
const auditState={rows:[],hasMore:false,offset:0,loading:false,meta:{actions:[],users:[],businesses:[]},filters:{search:'',action:'',userId:'',businessId:'',from:daysAgoISO(30),to:todayISO(),allHistory:false}};

function safeDetails(value){
  const redact=(input,key='')=>{
    if(input===null||input===undefined)return input;
    if(typeof input==='string' || typeof input==='number' || typeof input==='boolean'){
      return /password|token|secret|credential|privatekey|csrf/i.test(key)?'••••••':input;
    }
    if(Array.isArray(input))return input.map(x=>redact(x,key));
    if(typeof input==='object')return Object.fromEntries(Object.entries(input).map(([k,v])=>[k,redact(v,k)]));
    return String(input);
  };
  return redact(value);
}
function prettyDetails(value){
  const safe=safeDetails(value||{});
  return esc(JSON.stringify(safe,null,2));
}
function formatDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?String(value||'—'):d.toLocaleString();}
function roleScope(){return normalizedRole(state.user?.role);}

export function auditPage(){
  if(!can('audit.view'))return pageShell('Audit Log','<div class="notice error">You do not have permission to view the audit log.</div>');
  return pageShell('Audit Log',`<div class="page-intro"><div><div class="eyebrow">Security and accountability</div><h2>Audit trail</h2><p>Review recorded changes and security-relevant activity for this company. Audit entries are read-only from the application.</p></div><div style="display:flex;gap:8px;align-items:center"><span class="pill">${esc(roleScope()==='administrator'||roleScope()==='admin'?'Administrator':'Authorized viewer')}</span><button class="btn" id="auditRefresh">Refresh</button></div></div>
    <div class="panel" style="margin-bottom:16px"><form id="auditFilters" class="form-grid" style="grid-template-columns:2fr repeat(5,minmax(130px,1fr));align-items:end">
      <div class="field"><label>Search</label><input class="input" name="search" placeholder="Action, user, entity or detail…" value="${esc(auditState.filters.search)}"></div>
      <div class="field"><label>Action</label><select class="input" name="action"><option value="">All actions</option>${auditState.meta.actions.map(x=>`<option value="${esc(x)}" ${x===auditState.filters.action?'selected':''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="field"><label>User</label><select class="input" name="userId"><option value="">All users</option>${auditState.meta.users.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(auditState.filters.userId)?'selected':''}>${esc(x.displayName||x.username||x.id)}</option>`).join('')}</select></div>
      <div class="field"><label>Business</label><select class="input" name="businessId"><option value="">All businesses</option>${auditState.meta.businesses.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(auditState.filters.businessId)?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>From</label><input class="input" type="date" name="from" value="${esc(auditState.filters.from)}"></div>
      <div class="field"><label>To</label><input class="input" type="date" name="to" value="${esc(auditState.filters.to)}"></div>
      <div class="field" style="display:flex;align-items:center;gap:8px;padding-bottom:8px"><input type="checkbox" name="allHistory" value="1" ${auditState.filters.allHistory?'checked':''} id="auditAllHistory"><label for="auditAllHistory">All history</label></div>
      <div style="display:flex;gap:8px;grid-column:1/-1"><button class="btn primary" type="submit">Apply filters</button><button class="btn ghost" type="button" id="auditClear">Last 30 days</button></div>
    </form></div>
    <div class="panel"><div id="auditSummary" class="small" style="margin-bottom:12px">Loading audit activity…</div><div id="auditTable" class="table-wrap"></div><div id="auditPager" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px"></div></div>`);
}

export async function bindAudit(){
  if(!can('audit.view'))return;
  document.getElementById('auditFilters')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);auditState.filters={...auditState.filters,search:String(f.get('search')||'').trim(),action:String(f.get('action')||''),userId:String(f.get('userId')||''),businessId:String(f.get('businessId')||''),from:String(f.get('from')||''),to:String(f.get('to')||''),allHistory:f.get('allHistory')==='1'};
    if(auditState.filters.allHistory){auditState.filters.from='';auditState.filters.to='';}auditState.offset=0;await loadAudit();});
  document.getElementById('auditClear')?.addEventListener('click',async()=>{auditState.filters={search:'',action:'',userId:'',businessId:'',from:daysAgoISO(30),to:todayISO(),allHistory:false};auditState.offset=0;window.ReportGen.render();await loadAudit();});
  document.getElementById('auditRefresh')?.addEventListener('click',()=>loadAudit());
  document.getElementById('auditAllHistory')?.addEventListener('change',e=>{const on=e.currentTarget.checked;document.querySelector('#auditFilters [name=\"from\"]')?.toggleAttribute('disabled',on);document.querySelector('#auditFilters [name=\"to\"]')?.toggleAttribute('disabled',on);});
  await loadAudit();
  void loadMeta();
}
async function loadMeta(){
  try{
    auditState.meta=await api('/api/audit/meta');
    const form=document.getElementById('auditFilters');
    if(!form)return;
    const setOptions=(name,items,emptyLabel)=>{
      const select=form.elements[name];
      if(!select)return;
      const current=select.value;
      select.innerHTML=`<option value="">${esc(emptyLabel)}</option>`+items.map(item=>`<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('');
      select.value=current;
    };
    setOptions('action',auditState.meta.actions.map(x=>({value:x,label:x})),'All actions');
    setOptions('userId',auditState.meta.users.map(x=>({value:x.id,label:x.displayName||x.username||x.id})),'All users');
    setOptions('businessId',auditState.meta.businesses.map(x=>({value:x.id,label:x.name})),'All businesses');
  }catch(err){toast(err.message);}
}
async function loadAudit(){
  const table=document.getElementById('auditTable'),summary=document.getElementById('auditSummary'),pager=document.getElementById('auditPager');if(!table)return;
  auditState.loading=true;table.innerHTML='<div class="small">Loading audit activity…</div>';
  const q=new URLSearchParams({limit:String(pageSize),offset:String(auditState.offset),allHistory:auditState.filters.allHistory?'1':'0'});for(const [k,v] of Object.entries(auditState.filters))if(v)q.set(k,v);
  try{
    const d=await runWithLoading('Loading audit trail…',()=>api(`/api/audit?${q.toString()}`),180);auditState.rows=d.audit||[];auditState.hasMore=Boolean(d.pagination?.hasMore);
    const first=auditState.rows.length?auditState.offset+1:0;
    const last=auditState.offset+auditState.rows.length;
    const range=d.filters?.from&&d.filters?.to?`${d.filters.from} to ${d.filters.to}`:(d.filters?.allHistory?'all history':'recent activity');
    summary.textContent=auditState.rows.length?`Showing ${first}–${last} from ${range}${auditState.hasMore?' · more records available':''}.`:`No audit activity found for ${range}.`;
    table.innerHTML=auditState.rows.length?`<table class="users-management-table"><thead><tr><th>Date</th><th>User</th><th>Action</th><th>Entity</th><th>Business</th><th>Details</th></tr></thead><tbody>${auditState.rows.map((x,i)=>`<tr><td style="white-space:nowrap">${esc(formatDate(x.createdAt))}</td><td><strong>${esc(x.displayName||x.username||'System')}</strong><div class="small">${esc(x.username||'')}</div></td><td><span class="pill">${esc(x.action)}</span></td><td>${esc(x.entityType||'—')}<div class="small">${esc(x.entityId||'')}</div></td><td>${esc(auditState.meta.businesses.find(b=>String(b.id)===String(x.businessId))?.name||x.businessId||'Company-wide')}</td><td><details><summary>View details</summary><pre style="white-space:pre-wrap;max-width:520px;overflow:auto;margin:10px 0 0">${prettyDetails(x.details)}</pre></details></td></tr>`).join('')}</tbody></table>`:'<div class="empty">No audit activity matches the selected filters.</div>';
    pager.innerHTML=`<button class="btn" id="auditPrev" ${auditState.offset<=0?'disabled':''}>← Previous</button><span class="small">Page ${Math.floor(auditState.offset/pageSize)+1}</span><button class="btn" id="auditNext" ${!auditState.hasMore?'disabled':''}>Next →</button>`;
    document.getElementById('auditPrev')?.addEventListener('click',()=>{auditState.offset=Math.max(0,auditState.offset-pageSize);loadAudit()});document.getElementById('auditNext')?.addEventListener('click',()=>{if(auditState.hasMore){auditState.offset+=pageSize;loadAudit()}});
  }catch(err){summary.textContent='';table.innerHTML=`<div class="notice error">${esc(err.message)}</div>`;pager.innerHTML='';}
  finally{auditState.loading=false;}
}
