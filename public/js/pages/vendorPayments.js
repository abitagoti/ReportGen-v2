import {state,esc,money,can,normalizedRole} from '../state.js';
import {api,submissionKey} from '../api.js';
import {pageShell,toast,modal} from '../components/ui.js';
import {dateFieldMarkup,bindCustomDateFields} from '../components/dateInput.js';

let rows=[];
let loadedRange='';
const managementRoles=['owner','general_manager','administrator','admin'];
const isManagement=()=>managementRoles.includes(normalizedRole(state.user?.role));
const range=()=>({start:state.dashboardStart||`${state.dashboardMonth}-01`,end:state.dashboardEnd||`${state.dashboardMonth}-${String(new Date(Date.UTC(Number(state.dashboardMonth.slice(0,4)),Number(state.dashboardMonth.slice(5,7)),0)).getUTCDate()).padStart(2,'0')}`});
const businessName=id=>state.businesses.find(b=>b.id===id)?.name||'Company-wide';
const escAttr=esc;
const total=items=>items.reduce((s,x)=>s+Number(x.amount||0),0);

function table(items){
  if(!items.length)return '<div class="empty">No vendor payments recorded for the selected period.</div>';
  return `<div class="table-wrap vendor-payments-table-wrap"><table class="vendor-payments-table"><thead><tr><th>Date</th><th>Business</th><th>Amount</th><th>Note</th><th>Actions</th></tr></thead><tbody>${items.map(x=>`<tr><td><strong>${esc(x.paymentDate)}</strong></td><td>${esc(x.businessName||'Company-wide')}</td><td><strong>${money(x.amount)}</strong></td><td>${esc(x.note||'—')}</td><td><div class="table-actions compact-actions"><button class="btn tiny ghost" data-edit-vendor-payment="${escAttr(x.id)}">Edit</button><button class="btn tiny danger" data-delete-vendor-payment="${escAttr(x.id)}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`;
}

export function vendorPaymentsPage(){
  const r=range();
  const selected=total(rows);
  return pageShell('Vendor Payments',`<div class="page-intro"><div><div class="eyebrow">Owner cash tracking</div><h2>Vendor Payments</h2><p>Record how much the owner paid to vendors. Vendor names are optional—you can enter a simple amount and note for any day.</p></div><div class="actions">${can('vendor_payments.manage')?'<button class="btn primary" id="addVendorPayment">+ Record payment</button>':''}</div></div><div class="kpis"><div class="kpi"><div class="kpi-top"><span>Paid in selected period</span><span class="kpi-icon">₦</span></div><div class="kpi-value">${money(selected)}</div><div class="kpi-note">Vendor payments</div></div><div class="kpi"><div class="kpi-top"><span>Payment entries</span><span class="kpi-icon">≡</span></div><div class="kpi-value">${rows.length}</div><div class="kpi-note">Recorded payments</div></div><div class="kpi"><div class="kpi-top"><span>Average entry</span><span class="kpi-icon">↗</span></div><div class="kpi-value">${money(rows.length?selected/rows.length:0)}</div><div class="kpi-note">Across selected period</div></div></div><section class="panel"><div class="panel-head"><div><h3>Payment history</h3><p>${esc(r.start)} to ${esc(r.end)}. Business and note are optional.</p></div><button class="btn" data-page="dashboard">Back to dashboard</button></div>${table(rows)}</section>`);
}

function formMarkup(record={}){
  const selected=record.businessId||'';
  const options=state.businesses.map(b=>`<option value="${escAttr(b.id)}" ${selected===b.id?'selected':''}>${esc(b.name)}</option>`).join('');
  const date=record.paymentDate||state.dashboardStart||new Date().toISOString().slice(0,10);
  return `<form id="vendorPaymentForm" class="form-grid">${dateFieldMarkup({label:'Payment date',name:'paymentDate',value:date,required:true})}<label>Business <span class="small">(optional)</span><select class="input" name="businessId"><option value="">Company-wide / not assigned</option>${options}</select></label><label>Amount<input class="input" name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" value="${escAttr(record.amount??'')}"></label><label style="grid-column:1/-1">Note <span class="small">(optional)</span><input class="input" name="note" maxlength="500" placeholder="e.g. Paid suppliers today" value="${escAttr(record.note||'')}"></label><p class="small" style="grid-column:1/-1">You do not need to create or select a vendor. If you prefer, record one total for the day and use the note only as a reminder.</p><div class="button-row" style="grid-column:1/-1"><button class="btn primary" type="submit">${record.id?'Save changes':'Save payment'}</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`;
}

function openForm(record=null){
  const wrap=modal(record?'Edit vendor payment':'Record vendor payment',formMarkup(record||{}));
  bindCustomDateFields(wrap);
  wrap.querySelector('form')?.addEventListener('submit',async e=>{
    e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget).entries());data.businessId=data.businessId||null;data.amount=Number(data.amount);
    try{await api(record?`/api/vendor-payments/${encodeURIComponent(record.id)}`:'/api/vendor-payments',{method:record?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),idempotencyKey:record?undefined:submissionKey(e.currentTarget,'vendor-payment')});toast(record?'Vendor payment updated.':'Vendor payment recorded.');wrap.remove();await load();window.ReportGen.render();}catch(err){toast(err.message)}});
}

async function load(silent=false){
  const r=range();
  const businessId=state.dashboardBusinessId||'';
  const d=await api(`/api/vendor-payments?start=${encodeURIComponent(r.start)}&end=${encodeURIComponent(r.end)}${businessId?`&businessId=${encodeURIComponent(businessId)}`:''}`,silent?{silent:true}:{});
  rows=d.rows||[];loadedRange=`${r.start}:${r.end}:${businessId}`;
}

export async function bindVendorPayments(){
  if(!isManagement())return;
  const r=range(),key=`${r.start}:${r.end}:${state.dashboardBusinessId||''}`;
  if(loadedRange!==key){await load(true);window.ReportGen.render();return;}
  document.getElementById('addVendorPayment')?.addEventListener('click',()=>openForm());
  document.querySelectorAll('[data-edit-vendor-payment]').forEach(b=>b.addEventListener('click',()=>{const row=rows.find(x=>x.id===b.dataset.editVendorPayment);if(row)openForm(row);}));
  document.querySelectorAll('[data-delete-vendor-payment]').forEach(b=>b.addEventListener('click',async()=>{const row=rows.find(x=>x.id===b.dataset.deleteVendorPayment);if(!row)return;if(!confirm('Delete this vendor payment record? This action cannot be undone.'))return;try{await api(`/api/vendor-payments/${encodeURIComponent(row.id)}`,{method:'DELETE'});toast('Vendor payment deleted.');await load();window.ReportGen.render();}catch(err){toast(err.message)}}));
}
