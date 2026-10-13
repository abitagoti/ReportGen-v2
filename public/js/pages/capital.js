import {state,esc,money,can} from '../state.js';
import {api,submissionKey} from '../api.js';
import {pageShell,toast} from '../components/ui.js';
import {dateFieldMarkup,bindCustomDateFields} from '../components/dateInput.js';

let rows=[];
let loadedRange='';
let filterMonth=new Date().toISOString().slice(0,7);

const monthRange=month=>({start:`${month}-01`,end:`${month}-${String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0')}`});
const businessName=id=>state.businesses.find(b=>b.id===id)?.name||'Company-wide';
const escAttr=esc;
const ownerRoles=['owner','general_manager','administrator','admin'];
const canManageAll=()=>ownerRoles.includes(String(state.user?.role||'').toLowerCase());

function totals(items){return items.reduce((s,x)=>s+Number(x.amount||0),0)}
function canDeleteRecord(x){
  const userId=state.user?.user_id||state.user?.id;
  const role=String(state.user?.role||'').toLowerCase();
  return canManageAll() || (role==='business_manager' && String(x.createdBy||'')===String(userId||''));
}
function actionButtons(x){
  const id=escAttr(x.id);
  return `<div class="table-actions compact-actions"><button class="btn tiny ghost" data-view-purchase="${id}">View</button>${canManageAll()?`<button class="btn tiny ghost" data-edit-purchase="${id}">Edit</button>`:''}${canDeleteRecord(x)?`<button class="btn tiny danger" data-delete-purchase="${id}">Delete</button>`:''}</div>`;
}
function purchaseDate(x){return x.entryMode==='monthly_total'?String(x.periodStart||'').slice(0,7):x.purchaseDate||x.periodStart||''}
function table(items){
  if(!items.length)return '<div class="empty">No purchase records found for this period.</div>';
  return `<div class="table-wrap purchases-table-wrap"><table class="purchases-table"><colgroup><col class="col-date"><col class="col-business"><col class="col-amount"><col class="col-mode"><col class="col-note"><col class="col-actions"></colgroup><thead><tr><th>Date</th><th>Business</th><th>Amount</th><th>Input method</th><th>Note</th><th>Actions</th></tr></thead><tbody>${items.map(x=>`<tr><td><strong>${esc(purchaseDate(x))}</strong></td><td>${esc(x.businessName||'Company-wide')}</td><td><strong>${money(x.amount)}</strong></td><td><span class="pill ${x.entryMode==='monthly_total'?'warn':'success'}">${esc(x.entryMode==='monthly_total'?'Monthly total':'Individual')}</span></td><td>${esc(x.note||'—')}</td><td>${actionButtons(x)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function capitalPage(){
  filterMonth=state.dashboardMonth||filterMonth;
  const start=state.dashboardStart||`${filterMonth}-01`,end=state.dashboardEnd||monthRange(filterMonth).end;
  const filtered=rows.filter(x=>String(x.periodStart||'')<=end&&String(x.periodEnd||'')>=start);
  const all=totals(rows), selected=totals(filtered);
  return pageShell('Purchases',`<div class="page-intro"><div><div class="eyebrow">Purchases & funding</div><h2>Purchases</h2><p>Record purchases and capital deployed into the company or an individual business, then review them alongside financial performance.</p></div><div class="actions">${can('capital.manage')?'<button class="btn primary" id="addCapital">+ Add purchase</button>':''}</div></div><div class="kpis"><div class="kpi"><div class="kpi-top"><span>Selected period</span><span class="kpi-icon">₦</span></div><div class="kpi-value">${money(selected)}</div><div class="kpi-note">Purchases / capital</div></div><div class="kpi"><div class="kpi-top"><span>All recorded</span><span class="kpi-icon">◈</span></div><div class="kpi-value">${money(all)}</div><div class="kpi-note">Across all periods</div></div><div class="kpi"><div class="kpi-top"><span>Records</span><span class="kpi-icon">≡</span></div><div class="kpi-value">${filtered.length}</div><div class="kpi-note">Selected period</div></div><div class="kpi"><div class="kpi-top"><span>Businesses</span><span class="kpi-icon">▦</span></div><div class="kpi-value">${new Set(filtered.map(x=>x.businessId||'company')).size}</div><div class="kpi-note">Receiving purchases</div></div></div><section class="panel"><div class="panel-head"><div><h3>Purchase records</h3><p>Company-wide and business-specific purchase entries. The table adapts to the available page width.</p></div></div>${table(filtered)}</section>`);
}

function formMarkup(record={}){
  const manager=String(state.user?.role||'').toLowerCase()==='business_manager';
  const selected=record.businessId||state.businesses[0]?.id||'';
  const options=state.businesses.map(b=>`<option value="${escAttr(b.id)}" ${selected===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const date=record.entryMode==='monthly_total'?String(record.periodStart||`${filterMonth}-01`).slice(0,7)+'-01':record.purchaseDate||record.periodStart||`${filterMonth}-01`;
  return `<form id="purchaseForm" class="form-grid"><label>Business<select class="input" name="businessId" required>${manager?'':`<option value="">Company-wide</option>`}${options}</select></label><label>Input method<select class="input" name="entryMode"><option value="individual" ${record.entryMode!=='monthly_total'?'selected':''}>Individual purchase</option><option value="monthly_total" ${record.entryMode==='monthly_total'?'selected':''}>Monthly total</option></select></label><label>Amount<input class="input" name="amount" type="number" min="0" step="0.01" required placeholder="0.00" value="${escAttr(record.amount??'')}"></label>${dateFieldMarkup({label:'Date',name:'purchaseDate',value:date,required:true})}<label style="grid-column:1/-1">Description / note<input class="input" name="note" maxlength="500" placeholder="What was purchased or funded?" value="${escAttr(record.note||'')}"></label><p class="small" style="grid-column:1/-1">For a monthly total, select any date in the month. Avoid entering a monthly total alongside the same purchases individually.</p><div class="button-row" style="grid-column:1/-1"><button class="btn primary" type="submit">${record.id?'Save changes':'Save purchase'}</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`;
}

function viewMarkup(record){
  return `<div class="purchase-detail"><div class="detail-list"><div><span>Business</span><strong>${esc(record.businessName||'Company-wide')}</strong></div><div><span>Amount</span><strong>${money(record.amount)}</strong></div><div><span>Date</span><strong>${esc(purchaseDate(record))}</strong></div><div><span>Input method</span><strong>${esc(record.entryMode==='monthly_total'?'Monthly total':'Individual')}</strong></div><div><span>Created by</span><strong>${esc(record.createdBy||'—')}</strong></div><div><span>Last updated</span><strong>${esc(record.updatedAt||'—')}</strong></div></div><div class="purchase-note"><span>Note</span><p>${esc(record.note||'No note provided.')}</p></div></div>`;
}

async function load(silent=false){const start=state.dashboardStart||`${state.dashboardMonth}-01`,end=state.dashboardEnd||monthRange(state.dashboardMonth).end;const d=await api(`/api/capital?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,silent?{silent:true}:{});rows=d.contributions||[];loadedRange=`${start}:${end}`;}
function findRecord(id){return rows.find(x=>x.id===id);}
function openModal(title,content,onReady){
  const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<div class="modal modal-scroll" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">ReportGen</div><h3>${title}</h3></div><button class="close" data-close aria-label="Close">×</button></div><div class="modal-content">${content}</div></div>`;document.body.appendChild(wrap);
  const close=()=>wrap.remove();wrap.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',close));bindCustomDateFields(wrap);
  onReady?.(wrap,close);
  return {wrap,close};
}
function openForm(record=null){
  return openModal(record?'Edit purchase record':'Add purchase record',formMarkup(record||{}),(wrap,close)=>{
    wrap.querySelector('form')?.addEventListener('submit',async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget).entries());data.businessId=data.businessId||null;data.amount=Number(data.amount);try{const url=record?`/api/capital/${encodeURIComponent(record.id)}`:'/api/capital';await api(url,{method:record?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),idempotencyKey:record?undefined:submissionKey(e.currentTarget,'capital')});toast(record?'Purchase updated.':'Purchase saved.');close();await load();window.ReportGen.render();}catch(err){toast(err.message)}});
  });
}
function openView(record){openModal('Purchase details',viewMarkup(record),(wrap)=>{if(canManageAll()){const button=document.createElement('button');button.className='btn primary';button.textContent='Edit purchase';button.style.marginTop='16px';button.addEventListener('click',()=>{wrap.remove();openForm(record)});wrap.querySelector('.modal-content').appendChild(button);}});}

export async function bindCapital(){
  const rangeKey=`${state.dashboardStart}:${state.dashboardEnd}`;if(loadedRange!==rangeKey){await load(true);window.ReportGen.render();return;}
  document.getElementById('addCapital')?.addEventListener('click',()=>openForm());
  document.querySelectorAll('[data-view-purchase]').forEach(button=>button.addEventListener('click',()=>{const record=findRecord(button.dataset.viewPurchase);if(record)openView(record);}));
  document.querySelectorAll('[data-edit-purchase]').forEach(button=>button.addEventListener('click',()=>{const record=findRecord(button.dataset.editPurchase);if(record)openForm(record);}));
  document.querySelectorAll('[data-delete-purchase]').forEach(button=>button.addEventListener('click',async()=>{const record=findRecord(button.dataset.deletePurchase);if(!record)return;if(!confirm('Delete this purchase record? This action cannot be undone.'))return;try{await api(`/api/capital/${encodeURIComponent(record.id)}`,{method:'DELETE'});toast('Purchase deleted.');await load();window.ReportGen.render();}catch(err){toast(err.message)}}));
}

export async function loadCapital(){await load(true);}
