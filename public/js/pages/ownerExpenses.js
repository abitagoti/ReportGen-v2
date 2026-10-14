import {state,esc,money,dateRangeLabel} from '../state.js';
import {api} from '../api.js';
import {pageShell,toast} from '../components/ui.js';

let loadedMonth='';
let loadedRange='';
let rows=[];
let view='overview';
let selectedBusiness='';

function monthLabel(month){return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-NG',{month:'long',year:'numeric'});}
function total(list=rows){return list.reduce((sum,row)=>sum+Number(row.amount||0),0);}
function expenseItem(row){return row.category||row.description||'Uncategorized';}
function businesses(){return [...new Map(rows.map(row=>[row.businessId,{id:row.businessId,name:row.businessName||row.businessId}])).values()].sort((a,b)=>a.name.localeCompare(b.name));}
function businessRows(id){return rows.filter(row=>row.businessId===id);}
function matrix(){
  if(!rows.length)return '<div class="empty">No expenses recorded for this month.</div>';
  const bs=businesses();
  const items=[...new Set(rows.map(expenseItem))].sort((a,b)=>a.localeCompare(b));
  const amount=(item,id)=>rows.filter(row=>row.businessId===id&&expenseItem(row)===item).reduce((sum,row)=>sum+Number(row.amount||0),0);
  const businessTotal=id=>total(businessRows(id));
  const itemTotal=item=>rows.filter(row=>expenseItem(row)===item).reduce((sum,row)=>sum+Number(row.amount||0),0);
  return `<div class="table-wrap owner-expenses-table-wrap"><table class="owner-expenses-table"><thead><tr><th>Expense item</th>${bs.map(b=>`<th>${esc(b.name)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${items.map(item=>`<tr><td><strong>${esc(item)}</strong></td>${bs.map(b=>`<td>${money(amount(item,b.id))}</td>`).join('')}<td><strong>${money(itemTotal(item))}</strong></td></tr>`).join('')}<tr><th>Total</th>${bs.map(b=>`<th>${money(businessTotal(b.id))}</th>`).join('')}<th>${money(total())}</th></tr></tbody></table></div>`;
}
function detailTable(list){
  if(!list.length)return '<div class="empty">No expenses recorded for this business in the selected month.</div>';
  return `<div class="table-wrap owner-expenses-table-wrap"><table class="owner-expenses-table"><thead><tr><th>Date</th><th>Expense item</th><th>Notes</th><th>Amount</th><th>Recorded</th></tr></thead><tbody>${list.map(row=>`<tr><td>${esc(row.expenseDate)}</td><td>${esc(expenseItem(row))}${row.sharedExpenseId?' <span class="pill success">Shared allocation</span>':''}</td><td>${esc(row.notes||'—')}</td><td><strong>${money(row.amount)}</strong></td><td><span class="pill success">Recorded</span><div class="small">${esc(row.createdAt||'—')}</div></td></tr>`).join('')}</tbody></table></div>`;
}
function cards(){
  const bs=businesses();
  if(!bs.length)return '<div class="empty">No businesses have recorded expenses for this month.</div>';
  return `<div class="import-history-cards">${bs.map(b=>{const list=businessRows(b.id);return `<article class="import-history-card"><div class="import-history-top"><div><div class="eyebrow">Business expense record</div><h3>${esc(b.name)}</h3></div><span class="pill success">${list.length} record(s)</span></div><div class="import-history-meta"><div><span>Total expenses</span><strong>${money(total(list))}</strong></div><div><span>Expense items</span><strong>${new Set(list.map(expenseItem)).size}</strong></div></div><button class="btn primary" data-owner-open-business="${esc(b.id)}">Open expense record</button></article>`;}).join('')}</div>`;
}
function overview(){
  return `<section class="panel"><div class="panel-head"><div><h3>Composite expense list</h3><p>Expense items as rows and businesses as columns, matching the Accountant report format.</p></div></div>${matrix()}</section><section class="panel" style="margin-top:16px"><div class="panel-head"><div><h3>Business expense records</h3><p>Select a business card to open its detailed expense record.</p></div></div>${cards()}</section>`;
}
function recordPage(){
  const bs=businesses();
  const list=businessRows(selectedBusiness);
  const selected=bs.find(b=>b.id===selectedBusiness);
  return `<section class="panel"><div class="panel-head"><div><button class="btn ghost" id="ownerBackToExpenseOverview">← Back to expenses</button><div class="eyebrow" style="margin-top:12px">Expense record</div><h3>${esc(selected?.name||'Business')}</h3><p>Detailed expenses for ${esc(dateRangeLabel())}.</p></div><div class="field" style="min-width:240px"><label for="ownerExpenseBusiness">Select business</label><select class="select" id="ownerExpenseBusiness"><option value="">Choose business</option>${bs.map(b=>`<option value="${esc(b.id)}" ${b.id===selectedBusiness?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div></div><div class="kpis"><div class="kpi"><div class="kpi-top"><span>Total expenses</span><span class="kpi-icon">₦</span></div><div class="kpi-value">${money(total(list))}</div><div class="kpi-note">${esc(dateRangeLabel())}</div></div><div class="kpi"><div class="kpi-top"><span>Expense records</span><span class="kpi-icon">≡</span></div><div class="kpi-value">${list.length}</div><div class="kpi-note">Selected business</div></div></div>${detailTable(list)}</section>`;
}

export function ownerExpensesPage(){
  const month=state.dashboardMonth;
  return pageShell('Expenses',`<div class="page-intro"><div><div class="eyebrow">Owner workspace</div><h2>Expenses</h2><p>Company-wide operating expenses for ${esc(dateRangeLabel())}. Open a business card to inspect its detailed record.</p></div><div class="actions"><button class="btn" id="refreshOwnerExpenses">Refresh</button></div></div><div class="kpis"><div class="kpi"><div class="kpi-top"><span>Total expenses</span><span class="kpi-icon">₦</span></div><div class="kpi-value">${money(total())}</div><div class="kpi-note">${esc(dateRangeLabel())}</div></div><div class="kpi"><div class="kpi-top"><span>Expense records</span><span class="kpi-icon">≡</span></div><div class="kpi-value">${rows.length}</div><div class="kpi-note">Company-wide</div></div><div class="kpi"><div class="kpi-top"><span>Businesses affected</span><span class="kpi-icon">▦</span></div><div class="kpi-value">${businesses().length}</div><div class="kpi-note">Selected period</div></div></div>${view==='record'?recordPage():overview()}`);
}
async function load(month){const start=state.dashboardStart||`${month}-01`,end=state.dashboardEnd||`${month}-31`;const data=await api(`/api/owner/expenses?month=${encodeURIComponent(month)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);rows=data.expenses||[];loadedMonth=month;loadedRange=`${start}:${end}`;if(selectedBusiness&&!businesses().some(b=>b.id===selectedBusiness))selectedBusiness='';}
export async function bindOwnerExpenses(){
  const month=state.dashboardMonth;
  const range=`${state.dashboardStart}:${state.dashboardEnd}`;
  if(loadedMonth!==month||loadedRange!==range){try{await load(month);window.ReportGen.render();return;}catch(error){toast(error.message||'Unable to load expenses.');return;}}
  document.getElementById('refreshOwnerExpenses')?.addEventListener('click',async()=>{loadedRange='';await load(month);view='overview';window.ReportGen.render();});
  document.querySelectorAll('[data-owner-open-business]').forEach(button=>button.addEventListener('click',()=>{selectedBusiness=button.dataset.ownerOpenBusiness;view='record';window.ReportGen.render();}));
  document.getElementById('ownerBackToExpenseOverview')?.addEventListener('click',()=>{view='overview';window.ReportGen.render();});
  document.getElementById('ownerExpenseBusiness')?.addEventListener('change',event=>{if(event.target.value){selectedBusiness=event.target.value;view='record';window.ReportGen.render();}});
}
