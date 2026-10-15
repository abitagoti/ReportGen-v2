import {state,esc,money,can} from '../state.js';
import {api,submissionKey} from '../api.js';
import {pageShell,toast} from '../components/ui.js';
import {dateFieldMarkup,bindCustomDateFields} from '../components/dateInput.js';
let month=new Date().toISOString().slice(0,7), staff=[], businesses=[], departments=[], jobRoles=[], users=[], monthly=[], loans=[], loaded=false, payrollDetail=null, staffDetail=null;
// Every capability below comes from the role's permission toggles, never from the role name.
const canManage=()=>can('staff.manage');
const canCreatePayroll=()=>can('payroll.create');
const canSeeSalaries=()=>can('payroll.salaries');
const canRecordDeductions=()=>can('payroll.deductions');
let loadErrors=[];
const loadNotice=()=>loadErrors.length?`<div class="notice error" style="margin-bottom:12px">${loadErrors.map(esc).join('<br>')}</div>`:'';
const canManageLoans=()=>can('payroll.loans');
function monthName(m){return new Date(`${m}-01T00:00:00`).toLocaleDateString('en-NG',{month:'long',year:'numeric'})}
function form(title,body,kind,saveLabel='Save'){return `<div class="modal-backdrop" id="payroll-modal"><div class="modal modal-scroll"><div class="modal-head"><h3>${title}</h3><button class="btn ghost" data-close-payroll>✕</button></div><div class="modal-content">${body}</div><div class="modal-actions"><button class="btn" data-close-payroll>Cancel</button><button class="btn primary" data-save-payroll data-kind="${kind}">${saveLabel}</button></div></div></div>`}
function staffRows(){return staff.length?`<div class="table-wrap staff-directory-wrap"><table class="staff-directory-table"><thead><tr><th>Staff ID</th><th>Name</th><th>Business</th><th>Role</th><th>Department</th>${canSeeSalaries()?'<th>Base salary</th>':''}<th>Status</th><th>Actions</th></tr></thead><tbody>${staff.map(s=>`<tr><td><strong>${esc(s.employeeCode||'—')}</strong></td><td>${esc(s.employeeName)}</td><td>${esc(s.businessName||'')}</td><td>${esc(s.roleTitle||'—')}</td><td>${esc(s.department||'—')}</td>${canSeeSalaries()?`<td>${money(s.baseSalary||0)}</td>`:''}<td>${esc(s.status||'active')}</td><td><div class="table-actions compact-actions">${canManage()?`<button class="btn small" data-edit-staff="${esc(s.id)}">Edit</button><button class="btn small" data-status-staff="${esc(s.id)}">Status</button><button class="btn small danger" data-delete-staff="${esc(s.id)}">Delete</button>`:''}${canRecordDeductions()?`<button class="btn small" data-deduction-staff="${esc(s.id)}">Deduction</button>`:''}${canManageLoans()?`<button class="btn small" data-loan-staff="${esc(s.id)}">Loan</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No staff records found.</div>'}
function loanRows(){
  if(!canManageLoans()) return '';
  return `<section class="panel" style="margin-top:16px"><div class="panel-head"><div><h3>Staff loan schedules</h3><p>Skip a repayment month when approved. A skipped month extends a loan with an end date by one month.</p></div></div>${loans.length?`<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Business</th><th>Principal</th><th>Monthly</th><th>Period</th><th>Remaining</th><th>Action</th></tr></thead><tbody>${loans.map(l=>`<tr><td><strong>${esc(l.employeeName||'')}</strong></td><td>${esc(l.businessName||'')}</td><td>${money(l.principal_amount||l.principalAmount||0)}</td><td>${money(l.monthly_amount||l.monthlyAmount||0)}</td><td>${esc(l.start_month||l.startMonth||'')} – ${esc(l.end_month||l.endMonth||'Open')}</td><td>${money(l.remainingBalance||0)}</td><td>${String(l.status||'')==='active'?`<button class="btn small" data-skip-loan="${esc(l.id)}">Skip month</button>`:'<span class="small">'+esc(l.status||'')+'</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No staff loans recorded.</div>'}</section>`;
}
function payrollRows(){return businesses.length?businesses.map(b=>{const p=monthly.find(x=>String(x.businessId)===String(b.id));const status=p?.payrollStatus||'none';const paid=p?.paymentStatus==='paid';const label=paid?'Paid':status==='none'?'Not created':status==='draft'?'Draft':'Saved';const total=p?.payrollTotal||0;const paidTotal=Number(p?.amountPaid||0);return `<div class="mini-row"><div><strong>${esc(b.name)}</strong><div class="small">${esc(label)} · Net payable ${money(total)} · Paid ${money(paidTotal)} · Balance ${money(Math.max(0,total-paidTotal))}${Number(p?.overpayment||0)>0?` · Overpaid ${money(p.overpayment)}`:''}</div></div><div class="button-row">${canCreatePayroll()&&p?.payrollId&&status==='draft'?`<button class="btn" data-generate-payroll="${esc(b.id)}">Regenerate draft</button>`:''}${p?.payrollId?`<button class="btn primary" data-view-payroll="${esc(p.payrollId)}" data-business-id="${esc(b.id)}">${paid?'View':'View / Edit'}</button>${paid?'':'<button class="btn" data-delete-payroll="'+esc(p.payrollId)+'">Delete</button>'}`:''}${!p?.payrollId&&canCreatePayroll()?`<button class="btn primary" data-generate-payroll="${esc(b.id)}">Generate payroll</button>`:''}${canCreatePayroll()&&(!p?.payrollId||p?.calculationMode==='manual')?`<button class="btn" data-manual-payroll="${esc(b.id)}">Monthly total</button>`:''}${p?.payrollId&&canCreatePayroll()&&status==='saved'&&!paid?`<button class="btn" data-record-payroll-payment="${esc(p.payrollId)}" data-business-name="${esc(b.name)}">Record payment</button>`:''}${p?.payrollId&&canCreatePayroll()&&status!=='draft'?`<button class="btn" data-view-payroll-payments="${esc(p.payrollId)}" data-business-name="${esc(b.name)}">Payment history</button>`:''}</div></div>`}).join(''):'<div class="empty">No businesses available.</div>'}
export function payrollPage(){const selectedMonth=state.dashboardMonth||month;if(month!==selectedMonth){month=selectedMonth;loaded=false;payrollDetail=null;}const totals=monthly.reduce((a,p)=>{a.base+=Number(p.employeeGrossTotal||0);a.deductions+=Number(p.employeeDeductionsTotal||0);a.net+=Number(p.payrollTotal||0);return a},{base:0,deductions:0,net:0});const paid=monthly.reduce((n,p)=>n+Number(p.amountPaid||0),0);const outstanding=monthly.filter(p=>p.payrollStatus!=='none').reduce((n,p)=>n+Math.max(0,Number(p.payrollTotal||0)-Number(p.amountPaid||0)),0);return pageShell('Payroll',`<div class="page-intro"><div><div class="eyebrow">${canCreatePayroll()?'Payroll workspace':'Payroll view'}</div><h2>Monthly Payroll</h2></div><div class="small">${esc(monthName(month))}</div></div><section class="panel"><div class="panel-head"><div><h3>Monthly payroll summary</h3><p>Calculated from configured base salaries, active deductions and scheduled loan repayments.</p></div><button class="btn" data-refresh-payroll>Refresh</button></div><div class="kpis" style="margin-bottom:16px"><div class="kpi"><div class="kpi-top"><span>Base salaries</span></div><div class="kpi-value">${money(totals.base)}</div></div><div class="kpi"><div class="kpi-top"><span>Deductions + loans</span></div><div class="kpi-value">${money(totals.deductions)}</div></div><div class="kpi"><div class="kpi-top"><span>Expected net payroll</span></div><div class="kpi-value">${money(totals.net)}</div></div><div class="kpi"><div class="kpi-top"><span>Recorded as paid</span></div><div class="kpi-value">${money(paid)}</div></div><div class="kpi"><div class="kpi-top"><span>Outstanding (unpaid payrolls)</span></div><div class="kpi-value">${money(outstanding)}</div></div></div>${payrollRows()}</section>`)}
export function staffPage(){return pageShell('Staff Management',`<div class="page-intro"><div><div class="eyebrow">${canManage()?'Staff management':'Staff directory'}</div><h2>Central Staff Management</h2><p>Maintain staff records, assignments and permitted deductions. Payroll processing is on its own page.</p></div></div><div class="button-row" style="margin-bottom:16px">${canManage()?'<button class="btn primary" data-new-staff>+ Create staff</button>':''}${canManage()&&canSeeSalaries()?'<button class="btn" data-increase-salaries>Increase salaries</button>':''}<button class="btn" data-refresh-staff>Refresh staff</button></div>${loadNotice()}<section class="panel"><div class="panel-head"><div><h3>Staff directory</h3><p>Staff records, business assignments and permitted actions.</p></div></div>${staffRows()}</section>${loanRows()}`)}
function close(){document.querySelector('#payroll-modal')?.remove()}
function show(html){document.body.insertAdjacentHTML('beforeend',html)}
function businessOptions(){return businesses.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
function userOptions(selected=''){return `<option value="">No linked login account</option>`+users.filter(u=>u.isActive!==0).map(u=>`<option value="${esc(u.id)}" ${String(u.id)===String(selected)?'selected':''}>${esc(u.displayName||u.username)} · ${esc(u.username)}</option>`).join('')}
function customConfirm(title,message,confirmLabel='Continue',danger=false){
  return new Promise(resolve=>{
    const id='custom-confirm-modal';document.getElementById(id)?.remove();
    const m=document.createElement('div');m.className='modal-backdrop';m.id=id;
    m.innerHTML=`<div class="modal modal-scroll" role="dialog" aria-modal="true" aria-labelledby="custom-confirm-title"><div class="modal-head"><div><div class="eyebrow">Confirmation</div><h3 id="custom-confirm-title">${esc(title)}</h3></div><button class="btn ghost" data-confirm-cancel aria-label="Close">✕</button></div><div class="modal-content"><p>${esc(message)}</p></div><div class="modal-actions"><button class="btn" data-confirm-cancel>Cancel</button><button class="btn ${danger?'danger':'primary'}" data-confirm-yes>${esc(confirmLabel)}</button></div></div>`;
    document.body.appendChild(m);
    const finish=value=>{m.remove();resolve(value)};
    m.querySelectorAll('[data-confirm-cancel]').forEach(b=>b.addEventListener('click',()=>finish(false)));
    m.querySelector('[data-confirm-yes]')?.addEventListener('click',()=>finish(true));
  });
}
function customStatusPrompt(staffMember){
  return new Promise(resolve=>{
    const id='custom-status-modal';document.getElementById(id)?.remove();
    const current=staffMember.status||'active';
    const m=document.createElement('div');m.className='modal-backdrop';m.id=id;
    m.innerHTML=`<div class="modal modal-scroll" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">Staff management</div><h3>Update staff status</h3></div><button class="btn ghost" data-status-cancel aria-label="Close">✕</button></div><div class="modal-content"><p class="small">${esc(staffMember.employeeName||'Staff member')}</p><form id="custom-status-form" class="form-stack"><label class="field"><span>Status</span><select class="input" name="status" required><option value="active" ${current==='active'?'selected':''}>Active</option><option value="temporarily_archived" ${current==='temporarily_archived'?'selected':''}>Temporarily archived</option><option value="terminated" ${current==='terminated'?'selected':''}>Terminated</option></select></label><label class="field"><span>Reason (optional)</span><textarea class="input" name="reason" rows="3">${esc(staffMember.statusReason||'')}</textarea></label>${dateFieldMarkup({label:'Return date (optional)',name:'returnDate',value:staffMember.returnDate||''})}<span class="small">Used when the status is temporarily archived.</span></form></div><div class="modal-actions"><button class="btn" data-status-cancel>Cancel</button><button class="btn primary" data-status-save>Save status</button></div></div>`;
    document.body.appendChild(m);
    bindCustomDateFields(m);
    const finish=value=>{m.remove();resolve(value)};
    m.querySelectorAll('[data-status-cancel]').forEach(b=>b.addEventListener('click',()=>finish(null)));
    m.querySelector('[data-status-save]')?.addEventListener('click',()=>{const f=m.querySelector('form');if(!f.reportValidity())return;const d=Object.fromEntries(new FormData(f).entries());finish({status:d.status,statusReason:d.reason||'',returnDate:d.status==='temporarily_archived'?(d.returnDate||''):''});});
  });
}

function customReasonPrompt(title,message,confirmLabel='Confirm'){
  return new Promise(resolve=>{
    const id='custom-reason-modal';document.getElementById(id)?.remove();
    const m=document.createElement('div');m.className='modal-backdrop';m.id=id;
    m.innerHTML=`<div class="modal modal-scroll" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">Confirmation</div><h3>${esc(title)}</h3></div><button class="btn ghost" data-reason-cancel aria-label="Close">✕</button></div><div class="modal-content"><p>${esc(message)}</p><label class="field"><span>Reason</span><textarea class="input" data-reason-text maxlength="300" required></textarea></label></div><div class="modal-actions"><button class="btn" data-reason-cancel>Cancel</button><button class="btn danger" data-reason-yes>${esc(confirmLabel)}</button></div></div>`;
    document.body.appendChild(m);
    const text=m.querySelector('[data-reason-text]');text.focus();
    const finish=v=>{m.remove();resolve(v)};
    m.querySelectorAll('[data-reason-cancel]').forEach(b=>b.addEventListener('click',()=>finish(null)));
    m.querySelector('[data-reason-yes]').addEventListener('click',()=>{const v=text.value.trim();if(v.length<3){text.focus();return;}finish(v)});
  });
}
const paymentKpi=(label,value)=>`<div class="kpi"><div class="kpi-top"><span>${esc(label)}</span></div><div class="kpi-value">${money(value)}</div></div>`;
async function openPaymentModal(payrollId,businessName){
  let d;
  try{d=await api(`/api/payroll/${encodeURIComponent(payrollId)}/payments`)}catch(e){toast(e.message);return}
  document.getElementById('payment-modal')?.remove();
  const balance=Number(d.outstanding||0);
  const m=document.createElement('div');m.className='modal-backdrop';m.id='payment-modal';
  m.innerHTML=`<div class="modal modal-scroll" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">Payroll payment</div><h3>${esc(businessName||'Business')} · ${esc(monthName(month))}</h3></div><button class="btn ghost" data-pay-cancel aria-label="Close">✕</button></div><div class="modal-content"><div class="kpis" style="margin-bottom:16px">${paymentKpi('Net payable',d.expected)}${paymentKpi('Paid so far',d.paid)}${paymentKpi('Balance',balance)}</div><form id="payment-form" class="form-stack"><div class="form-grid"><label class="field"><span>Amount paid</span><input class="input" name="amount" type="number" min="0.01" step="0.01" value="${balance>0?balance.toFixed(2):''}" required></label><label class="field"><span>Payment date</span><input class="input" name="paymentDate" type="date" value="${esc(new Date().toISOString().slice(0,10))}" required></label><label class="field" style="grid-column:1/-1"><span>Note (optional)</span><input class="input" name="note" maxlength="200"></label></div></form><div class="notice error" data-pay-error style="display:none"></div></div><div class="modal-actions"><button class="btn" data-pay-cancel>Cancel</button>${can('payroll.finalize')&&d.expected>0?'<button class="btn" data-pay-mark>'+(balance>0?'Pay balance &amp; mark paid':'Mark paid')+'</button>':''}<button class="btn primary" data-pay-save>Record payment</button></div></div>`;
  document.body.appendChild(m);
  const form=m.querySelector('#payment-form'),save=m.querySelector('[data-pay-save]'),mark=m.querySelector('[data-pay-mark]'),err=m.querySelector('[data-pay-error]');
  const showError=msg=>{err.textContent=msg;err.style.display='block'};
  const busy=v=>{save.disabled=v;if(mark)mark.disabled=v};
  m.querySelectorAll('[data-pay-cancel]').forEach(b=>b.addEventListener('click',()=>m.remove()));
  const done=async message=>{m.remove();await load();window.ReportGen.render();toast(message)};
  save.addEventListener('click',async()=>{
    err.style.display='none';
    if(!form.reportValidity())return;
    const f=Object.fromEntries(new FormData(form).entries());
    const amount=Math.round(Number(f.amount)*100)/100;
    if(!Number.isFinite(amount)||amount<=0){showError('Enter an amount of at least 0.01.');return}
    let confirmOverpayment=false;
    if(amount>balance+0.005){
      if(!await customConfirm('Overpayment',`${money(amount)} is ${money(amount-balance)} more than the outstanding balance of ${money(balance)}. Record it as an overpayment?`,'Record overpayment',true))return;
      confirmOverpayment=true;
    }else if(amount>=balance-0.005){
      if(!await customConfirm('Settle payroll',`${money(amount)} settles the remaining balance. The payroll will be marked paid and locked.`,'Record and lock'))return;
    }
    busy(true);
    try{
      // One key per open dialog: a retry after a dropped connection is recognised instead of paying twice.
      const r=await api(`/api/payroll/${encodeURIComponent(payrollId)}/payments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,paymentDate:f.paymentDate,note:f.note||'',confirmOverpayment}),idempotencyKey:submissionKey(form,'payroll-payment')});
      await done(r?.message||'Payment recorded.');
    }catch(e){busy(false);showError(e.message)}
  });
  mark?.addEventListener('click',async()=>{
    err.style.display='none';
    if(!await customConfirm('Mark payroll paid',balance>0?`This records the remaining ${money(balance)} as paid and locks the payroll.`:'This marks the payroll as paid and locks it.','Mark paid'))return;
    busy(true);
    try{const r=await api(`/api/payroll/${encodeURIComponent(payrollId)}/paid`,{method:'POST',idempotencyKey:submissionKey(form,'payroll-mark-paid')});await done(r?.message||'Payroll marked as paid.')}
    catch(e){busy(false);showError(e.message)}
  });
}
async function openPaymentHistoryModal(payrollId,businessName){
  let d;
  try{d=await api(`/api/payroll/${encodeURIComponent(payrollId)}/payments`)}catch(e){toast(e.message);return}
  document.getElementById('payment-history-modal')?.remove();
  const canVoid=can('payroll.finalize');
  const rows=(d.payments||[]).map(p=>`<tr${p.status==='voided'?' style="opacity:.6"':''}><td>${esc(p.paymentDate)}</td><td>${p.status==='voided'?'<s>'+money(p.amount)+'</s>':money(p.amount)}</td><td>${esc(p.note||'')}${p.status==='voided'?`<div class="small">Voided: ${esc(p.voidReason||'')}</div>`:''}</td><td>${p.status==='voided'?'Voided':canVoid?`<button class="btn small danger" data-void-payment="${esc(p.id)}">Void</button>`:'Recorded'}</td></tr>`).join('');
  const m=document.createElement('div');m.className='modal-backdrop';m.id='payment-history-modal';
  m.innerHTML=`<div class="modal modal-scroll" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">Payment history</div><h3>${esc(businessName||'Business')} · ${esc(monthName(month))}</h3></div><button class="btn ghost" data-history-close aria-label="Close">✕</button></div><div class="modal-content"><div class="kpis" style="margin-bottom:16px">${paymentKpi('Net payable',d.expected)}${paymentKpi('Paid',d.paid)}${paymentKpi('Balance',d.outstanding)}</div>${Number(d.overpayment||0)>0?`<div class="notice">Overpaid by ${money(d.overpayment)}.</div>`:''}${rows?`<div class="table-wrap"><table class="compact-table"><thead><tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty">No payments recorded yet.</div>'}<p class="small" style="margin-top:12px">Payments are never deleted. A payment made in error is voided with a reason and stays in the history and audit log.</p></div><div class="modal-actions"><button class="btn" data-history-close>Close</button></div></div>`;
  document.body.appendChild(m);
  m.querySelectorAll('[data-history-close]').forEach(b=>b.addEventListener('click',()=>m.remove()));
  m.querySelectorAll('[data-void-payment]').forEach(b=>b.addEventListener('click',async()=>{
    const reason=await customReasonPrompt('Void payment','This payment will stay in the history as voided and no longer count as paid. If the payroll was locked as paid it will be opened again.','Void payment');
    if(!reason)return;
    try{const r=await api(`/api/payroll/${encodeURIComponent(payrollId)}/payments/${encodeURIComponent(b.dataset.voidPayment)}/void`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason}),idempotencyKey:`payroll-void-${b.dataset.voidPayment}`});m.remove();await load();window.ReportGen.render();toast(r?.message||'Payment voided.')}
    catch(e){toast(e.message)}
  }));
}
function bindModal(){document.querySelectorAll('[data-close-payroll]').forEach(x=>x.addEventListener('click',close));document.querySelector('[data-save-payroll]')?.addEventListener('click',saveModal)}
async function saveModal(){const button=document.querySelector('[data-save-payroll]');const kind=button?.dataset.kind;const f=document.querySelector('#payroll-form');if(!f||!f.reportValidity())return;const d=Object.fromEntries(new FormData(f).entries());try{if(kind==='staff')await api('/api/payroll/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...d,baseSalary:Number(d.baseSalary||0)}),idempotencyKey:submissionKey(f,'staff')});if(kind==='deduction')await api('/api/payroll/deductions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...d,amount:Number(d.amount||0),endMonth:d.endMonth||null}),idempotencyKey:submissionKey(f,'deduction')});if(kind==='loan')await api('/api/payroll/loans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...d,principalAmount:Number(d.principalAmount||0),monthlyAmount:Number(d.monthlyAmount||0),endMonth:d.endMonth||null}),idempotencyKey:submissionKey(f,'loan')});if(kind==='manual-total')await api('/api/payroll/monthly-total',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId:d.businessId,payrollMonth:month,amount:Number(d.amount),note:d.note||null}),idempotencyKey:submissionKey(f,'payroll-total')});close();await load();window.ReportGen.render()}catch(e){document.querySelector('#payroll-modal .modal-content')?.insertAdjacentHTML('beforeend',`<div class="notice error">${esc(e.message)}</div>`)}}
async function openPayroll(payrollId,businessId){
  const data=await api(`/api/payroll/entries?businessId=${encodeURIComponent(businessId)}&month=${encodeURIComponent(month)}`);
  if(canManageLoans()){try{data.loans=(await api('/api/payroll/loans')).loans||[]}catch{data.loans=[]}}
  const p=monthly.find(x=>String(x.payrollId)===String(payrollId));
  payrollDetail={payrollId,businessId,summary:p||{},data};
  state.page='payroll-detail';
  window.ReportGen.render();
}
export function payrollDetailPage(){
  if(payrollDetail&&month!==(state.dashboardMonth||month)){month=state.dashboardMonth;loaded=false;payrollDetail=null;state.page='payroll';return payrollPage();}
  const d=payrollDetail;
  if(!d)return pageShell('Payroll', '<div class="empty">Payroll not found.</div>');
  const entries=d.data.entries||[];
  const employees=d.data.employees||[];
  const status=d.summary.payrollStatus||'saved';
  const paid=d.summary.paymentStatus==='paid';
  const locked=paid;
  const business=businesses.find(b=>String(b.id)===String(d.businessId));
  const businessName=business?.name||'Business';
  const totalGross=entries.reduce((n,e)=>n+Number(e.grossAmount||0),0);
  const totalDeductions=entries.reduce((n,e)=>n+Number(e.deductions||0),0);
  const totalNet=entries.reduce((n,e)=>n+Number(e.netAmount||0),0);
  const monthlyTotal=Number(d.data.monthlyTotal?.amount||0);
  const displayedTotal=entries.length?totalNet:monthlyTotal;
  return pageShell('Payroll Details',`<div class="page-intro"><div><div class="eyebrow">PAYROLL · ${esc(status.toUpperCase())}</div><h2>${esc(businessName)} payroll</h2><p>${esc(monthName(month))}</p></div><div class="button-row"><button class="btn" data-payroll-back>← Back to Payroll</button><button class="btn" data-payroll-refresh>Refresh</button><button class="btn" data-payroll-print>Print</button><button class="btn" data-payroll-word>Export Word</button><button class="btn" data-payroll-excel>Export Excel</button></div></div><section class="panel"><div class="panel-head"><div><h3>Employee payroll entries</h3><p>${locked?'This payroll has been paid and is locked.':status==='draft'?'Review the generated payroll, then save it.':'Saved payroll. Use Skip loan to adjust a repayment month.'} Amounts are presented in ${esc(state.company?.currency||'NGN')}.</p></div><span class="pill ${status==='draft'?'warn':'success'}">${esc(status.toUpperCase())}</span></div><div class="kpis" style="margin-bottom:16px"><div class="kpi"><div class="kpi-top"><span>Base salary total</span></div><div class="kpi-value">${money(totalGross)}</div></div><div class="kpi"><div class="kpi-top"><span>Deductions</span></div><div class="kpi-value">${money(totalDeductions)}</div></div><div class="kpi"><div class="kpi-top"><span>Net payroll</span></div><div class="kpi-value">${money(displayedTotal)}</div></div></div><form id="payroll-detail-form"><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Base salary</th><th>Staff deductions</th><th>Loan repayment</th><th>Total deductions</th><th>Net</th>${canManageLoans()&&!locked?'<th>Loan action</th>':''}</tr></thead><tbody>${entries.length?entries.map((e,i)=>`<tr><td><strong>${esc(employees.find(x=>String(x.id)===String(e.employeeId))?.employeeName||e.employeeId)}</strong><input type="hidden" name="entryId${i}" value="${esc(e.id)}"></td><td>${money(e.grossAmount||0)}</td><td>${money(e.deductionAmount||0)}</td><td>${money(e.loanRepaymentAmount||0)}</td><td>${money(e.deductions||0)}</td><td>${money(e.netAmount||0)}</td>${canManageLoans()&&!locked?`<td>${(d.data.loans||[]).filter(l=>String(l.staff_id||l.staffId)===String(e.employeeId)&&String(l.status)==='active'&&String(l.start_month||l.startMonth)<=month&&(!String(l.end_month||l.endMonth||'')||String(l.end_month||l.endMonth)>=month)).map(l=>`<button type="button" class="btn small" data-skip-generated-loan="${esc(l.id)}" data-skip-staff="${esc(e.employeeId)}">Skip loan</button>`).join('')||'—'}</td>`:''}</tr>`).join(''):'<tr><td colspan="6"><div class="empty">No employee entries in this payroll.</div></td></tr>'}</tbody></table></div></form><div class="modal-actions" style="margin-top:16px">${locked?'':'<button class="btn danger" data-detail-delete>Delete payroll</button>'+(status==='draft'?'<button class="btn primary" data-detail-save>Save payroll</button>':'')}</div></section>`);
}
async function savePayrollDetail(){
  const d=payrollDetail;if(!d)return;
  // The detail page shows the generated figures read-only. Saving a draft only finalizes it as generated;
  // it must never re-send amounts (an earlier version read form fields that do not exist and zeroed every entry).
  if((d.summary.payrollStatus||'saved')!=='draft'){toast('This payroll is already saved.');return;}
  const button=document.querySelector('[data-detail-save]');if(button)button.disabled=true;
  try{await api(`/api/payroll/${encodeURIComponent(d.payrollId)}/save`,{method:'POST',idempotencyKey:`payroll-save-${d.payrollId}`});await load();payrollDetail=null;state.page='payroll';window.ReportGen.render();}
  catch(e){if(button)button.disabled=false;toast(e.message)}
}
function payrollExportRows(){
  const d=payrollDetail||{};const entries=d.data?.entries||[];const employees=d.data?.employees||[];
  return entries.map(e=>({employee:employees.find(x=>String(x.id)===String(e.employeeId))?.employeeName||e.employeeId,gross:Number(e.grossAmount||0),staffDeduction:Number(e.deductionAmount||0),loan:Number(e.loanRepaymentAmount||0),deductions:Number(e.deductions||0),net:Number(e.netAmount||0)}));
}
function payrollDocumentMarkup(){
  const d=payrollDetail||{};const business=businesses.find(b=>String(b.id)===String(d.businessId));const rows=payrollExportRows();
  const total=n=>rows.reduce((sum,r)=>sum+r[n],0);const title=`${business?.name||'Business'} Payroll - ${monthName(month)}`;
  const body=rows.map(r=>`<tr><td>${esc(r.employee)}</td><td class="num">${esc(money(r.gross))}</td><td class="num">${esc(money(r.staffDeduction))}</td><td class="num">${esc(money(r.loan))}</td><td class="num">${esc(money(r.deductions))}</td><td class="num">${esc(money(r.net))}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;color:#151515;padding:28px}h1{font-size:22px;margin:0 0 6px}p{color:#555}.meta{margin-bottom:20px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #bbb;padding:9px;text-align:left}th{background:#eee}.num{text-align:right}.total td{font-weight:bold;background:#f5f5f5}</style></head><body><h1>${esc(title)}</h1><div class="meta">Status: ${esc(d.summary?.payrollStatus||'saved')}<br>Generated: ${esc(new Date().toLocaleString('en-NG'))}</div><table><thead><tr><th>Employee</th><th>Base salary</th><th>Staff deductions</th><th>Loan repayment</th><th>Total deductions</th><th>Net</th></tr></thead><tbody>${body||'<tr><td colspan="6">No employee entries</td></tr>'}<tr class="total"><td>Total</td><td class="num">${esc(money(total('gross')))}</td><td class="num">${esc(money(total('staffDeduction')))}</td><td class="num">${esc(money(total('loan')))}</td><td class="num">${esc(money(total('deductions')))}</td><td class="num">${esc(money(total('net')))}</td></tr></tbody></table></body></html>`;
}
function downloadPayroll(extension,mime){const html=payrollDocumentMarkup();const blob=new Blob([html],{type:mime});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`payroll-${month}.${extension}`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function printPayroll(){const html=payrollDocumentMarkup();const w=window.open('','_blank','width=1000,height=800');if(!w){toast('Allow pop-ups to print the payroll.');return;}w.document.write(html);w.document.close();w.focus();w.print();}

export function bindPayrollDetailPage(){
  document.querySelector('[data-payroll-back]')?.addEventListener('click',()=>{payrollDetail=null;state.page='payroll';window.ReportGen.render()});
  document.querySelector('[data-payroll-print]')?.addEventListener('click',printPayroll);
  document.querySelector('[data-payroll-word]')?.addEventListener('click',()=>downloadPayroll('doc','application/msword'));
  document.querySelector('[data-payroll-excel]')?.addEventListener('click',()=>downloadPayroll('xls','application/vnd.ms-excel'));
  document.querySelector('[data-payroll-refresh]')?.addEventListener('click',()=>openPayroll(payrollDetail.payrollId,payrollDetail.businessId));
  document.querySelector('[data-detail-save]')?.addEventListener('click',savePayrollDetail);
  document.querySelectorAll('[data-skip-generated-loan]').forEach(b=>b.addEventListener('click',async()=>{const loanId=b.dataset.skipGeneratedLoan;if(!await customConfirm('Skip loan repayment',`Skip this staff member’s loan repayment for ${monthName(month)}? The loan end date will extend by one month where applicable.`,'Skip month'))return;try{await api(`/api/payroll/loans/${encodeURIComponent(loanId)}/skip`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skipMonth:month,reason:'Skipped from generated monthly payroll'})});await load();await openPayroll(payrollDetail.payrollId,payrollDetail.businessId)}catch(e){toast(e.message)}}));
  document.querySelector('[data-detail-delete]')?.addEventListener('click',async()=>{if(!await customConfirm('Delete payroll', 'Delete this payroll and its employee entries?', 'Delete', true))return;try{await api(`/api/payroll/${encodeURIComponent(payrollDetail.payrollId)}`,{method:'DELETE'});payrollDetail=null;await load();state.page='payroll';window.ReportGen.render()}catch(e){toast(e.message)}});
}

function openStaffEdit(id){const s=staff.find(x=>String(x.id)===String(id));if(!s)return;staffDetail=s;state.page='staff-detail';window.ReportGen.render()}
export function staffDetailPage(){const s=staffDetail;if(!s)return pageShell('Staff Details','<div class="empty">Staff record not found.</div>');return pageShell('Staff Details',`<div class="page-intro"><div><div class="eyebrow">STAFF MANAGEMENT</div><h2>${esc(s.employeeName)}</h2><p>${esc(s.employeeCode||'No staff ID')} · ${esc(s.status||'active')}</p></div><button class="btn" data-staff-detail-back>← Back to Staff</button></div><section class="panel"><form id="staff-detail-form"><div class="form-grid"><label class="field"><span>Business</span><select class="select" name="businessId" required>${businesses.map(b=>`<option value="${esc(b.id)}" ${String(b.id)===String(s.businessId)?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label><label class="field"><span>Full name</span><input class="input" name="employeeName" value="${esc(s.employeeName||'')}" required></label><label class="field"><span>Staff ID</span><input class="input" name="employeeCode" value="${esc(s.employeeCode||'')}" maxlength="12"></label><label class="field"><span>Department</span><select class="select" name="departmentId"><option value="">Select department</option>${departments.map(d=>`<option value="${esc(d.id)}" ${String(d.name)===String(s.department)?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label><label class="field"><span>Job role</span><select class="select" name="roleId"><option value="">Select job role</option>${jobRoles.map(r=>`<option value="${esc(r.id)}" ${String(r.name)===String(s.roleTitle)?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label>${canSeeSalaries()?`<label class="field"><span>Base salary</span><input class="input" name="baseSalary" type="number" min="0" step="0.01" value="${Number(s.baseSalary||0)}" required></label>`:''}<label class="field"><span>Linked login account</span><select class="select" name="linkedUserId">${userOptions(s.userId||'')}</select></label></div></form><div class="modal-actions" style="margin-top:16px"><button class="btn primary" data-save-staff-detail>Save changes</button></div></section>`)}
async function saveStaffDetail(){const s=staffDetail;const f=document.querySelector('#staff-detail-form');if(!s||!f||!f.reportValidity())return;const d=Object.fromEntries(new FormData(f).entries());const department=departments.find(x=>String(x.id)===String(d.departmentId))?.name||'';const roleTitle=jobRoles.find(x=>String(x.id)===String(d.roleId))?.name||'';try{await api(`/api/payroll/staff/${encodeURIComponent(s.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...d,department,roleTitle,baseSalary:Number(d.baseSalary||0)})});staffDetail=null;await load();state.page='staff';window.ReportGen.render()}catch(e){toast(e.message)}}
async function changeStaffStatus(id){const s=staff.find(x=>String(x.id)===String(id));if(!s)return;const result=await customStatusPrompt(s);if(!result)return;try{await api(`/api/payroll/staff/${encodeURIComponent(id)}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...result,returnDate:result.returnDate||null})});await load();window.ReportGen.render()}catch(e){toast(e.message)}}

async function deleteStaff(id){const s=staff.find(x=>String(x.id)===String(id));if(!s)return;const approved=await customConfirm('Delete staff record',`Remove ${s.employeeName} from active staff management? Historical payroll, loans, deductions, and audit records will be preserved.` ,'Delete',true);if(!approved)return;try{await api(`/api/payroll/staff/${encodeURIComponent(id)}`,{method:'DELETE'});toast('Staff removed from active management. History preserved.');await load();window.ReportGen.render()}catch(e){toast(e.message)}}

function openSalaryIncreaseModal(){
  const m=document.createElement('div');m.className='modal-backdrop';
  m.innerHTML=`<div class="modal modal-scroll salary-increase-modal"><div class="modal-head"><div><div class="eyebrow">Payroll management</div><h3>Increase salaries</h3></div><button class="close" data-close-salary>×</button></div><div class="modal-content"><p class="small">Search for staff, add them to the review list, then apply one increase to everyone in the list.</p><div class="field"><label>Search staff</label><input class="input" id="salaryStaffSearch" placeholder="Search by name, Staff ID, business or role"></div><div class="field"><label>Amount to add to each selected salary</label><input class="input" id="salaryIncreaseAmount" type="number" min="0.01" step="0.01" required placeholder="e.g. 25000"></div><div class="field"><label>Matching staff</label><div class="salary-selection-list" id="salarySelectionList"></div></div><div class="field"><label>Review list <span class="small" id="salaryReviewCount">(0)</span></label><div id="salaryReviewList"><div class="empty">No staff added yet.</div></div></div></div><div class="modal-actions"><button class="btn" data-close-salary>Cancel</button><button class="btn primary" id="applySalaryIncrease">Apply increase</button></div></div>`;
  document.body.appendChild(m);
  const list=m.querySelector('#salarySelectionList');
  const review=m.querySelector('#salaryReviewList');
  const search=m.querySelector('#salaryStaffSearch');
  const amountInput=m.querySelector('#salaryIncreaseAmount');
  const selected=new Map();
  let renderToken=0;
  const amount=()=>Number(amountInput.value||0);
  const renderReview=()=>{
    const increase=amount();
    m.querySelector('#salaryReviewCount').textContent=`(${selected.size})`;
    if(!selected.size){review.innerHTML='<div class="empty">No staff added yet.</div>';return;}
    review.innerHTML=`<div class="table-wrap"><table class="compact-table"><thead><tr><th>Staff</th><th>Current</th><th>Increase</th><th>New salary</th><th></th></tr></thead><tbody>${[...selected.values()].map(s=>`<tr><td><strong>${esc(s.employeeName)}</strong><div class="small">${esc(s.employeeCode||'—')} · ${esc(s.businessName||'')}</div></td><td>${money(s.baseSalary||0)}</td><td>${money(increase)}</td><td>${money(Number(s.baseSalary||0)+increase)}</td><td><button class="btn small" data-remove-salary="${esc(s.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div>`;
  };
  const renderResults=()=>{
    const token=++renderToken;const q=String(search.value||'').trim().toLowerCase();
    const rows=staff.filter(s=>!selected.has(String(s.id))&&[s.employeeName,s.employeeCode,s.businessName,s.roleTitle,s.department].some(v=>String(v||'').toLowerCase().includes(q)));
    if(token!==renderToken)return;
    list.innerHTML=rows.length?rows.map(s=>`<div class="salary-staff-option"><div><strong>${esc(s.employeeName)}</strong><div class="small">${esc(s.employeeCode||'—')} · ${esc(s.businessName||'')} · Current: ${money(s.baseSalary||0)}</div></div><button class="btn small" data-add-salary="${esc(s.id)}">Add</button></div>`).join(''):'<div class="empty">No matching staff found.</div>';
  };
  const rerender=()=>{renderResults();renderReview();};
  let searchFrame=null;
  search.addEventListener('input',()=>{if(searchFrame)clearTimeout(searchFrame);searchFrame=setTimeout(renderResults,120);});
  amountInput.addEventListener('input',renderReview);
  list.addEventListener('click',e=>{const b=e.target.closest('[data-add-salary]');if(!b)return;const s=staff.find(x=>String(x.id)===String(b.dataset.addSalary));if(!s)return;selected.set(String(s.id),s);rerender();});
  review.addEventListener('click',e=>{const b=e.target.closest('[data-remove-salary]');if(!b)return;selected.delete(String(b.dataset.removeSalary));rerender();});
  m.querySelectorAll('[data-close-salary]').forEach(b=>b.onclick=()=>m.remove());
  m.querySelector('#applySalaryIncrease').onclick=async()=>{
    const increase=amount();const staffIds=[...selected.keys()];
    if(!Number.isFinite(increase)||increase<=0){toast('Enter a valid increase amount.');return;}
    if(!staffIds.length){toast('Add at least one staff member to the review list.');return;}
    const apply=m.querySelector('#applySalaryIncrease');apply.disabled=true;apply.textContent='Applying…';
    try{await api('/api/payroll/staff/salary-increase',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({staffIds,amount:increase})});m.remove();await load();window.ReportGen.render();}
    catch(e){apply.disabled=false;apply.textContent='Apply increase';toast(e.message)}
  };
  renderResults();renderReview();
}

export function bindStaffDetailPage(){document.querySelector('[data-staff-detail-back]')?.addEventListener('click',()=>{staffDetail=null;state.page='staff';window.ReportGen.render()});document.querySelector('[data-save-staff-detail]')?.addEventListener('click',saveStaffDetail)}

async function openManualPayrollModal(businessId){
  try{
    const checklist=await api(`/api/payroll/manual-checklist?businessId=${encodeURIComponent(businessId)}&month=${encodeURIComponent(month)}`);
    const rows=checklist.staff||[];
    const existingManualAmount=Number(monthly.find(x=>String(x.businessId)===String(businessId))?.manualAmount||0);
    show(form('Monthly payroll total',`<form id="payroll-form"><input type="hidden" name="businessId" value="${esc(businessId)}"><div class="notice">${rows.length?'':'This business has no active staff, so type the monthly payroll total yourself. '}ReportGen calculates staff salary, active deductions and scheduled loan repayments from existing records. To skip a loan for this month, tick Skip loan; the repayment is excluded and the existing loan schedule is extended where applicable.</div><div class="form-grid">${rows.length?`<label class="field"><span>Calculated base salary total</span><input class="input" name="amount" type="number" min="0" step="0.01" value="${rows.reduce((n,r)=>n+Number(r.baseSalary||0),0)}" readonly required></label>`:`<label class="field"><span>Monthly payroll total</span><input class="input" name="amount" type="number" min="0" step="0.01" value="${existingManualAmount||''}" placeholder="Enter the total payroll for this month" required></label>`}<label class="field" style="grid-column:1/-1"><span>Note (optional)</span><textarea class="input" name="note" placeholder="Optional payroll reference"></textarea></label></div><h4>Calculated staff payroll</h4><div class="table-wrap"><table><thead><tr><th>Staff</th><th>Base salary</th><th>Deduction</th><th>Loan repayment</th><th>Skip loan</th><th>Net pay</th></tr></thead><tbody>${rows.length?rows.map(r=>{const gross=Number(r.baseSalary||0),ded=Math.min(gross,Number(r.activeDeductionAmount||0)),loan=Math.min(Math.max(0,gross-ded),Number(r.scheduledLoanAmount||0));return `<tr data-manual-staff-row="${esc(r.id)}"><td><strong>${esc(r.employeeName)}</strong><div class="small">${esc(r.employeeCode||'—')}</div><input type="hidden" name="staffId" value="${esc(r.id)}"></td><td>${money(gross)}<input type="hidden" name="grossAmount_${esc(r.id)}" value="${gross}"></td><td>${money(ded)}<input type="hidden" name="deductionAmount_${esc(r.id)}" value="${ded}"></td><td><span data-loan-amount>${money(loan)}</span><input type="hidden" name="loanRepaymentAmount_${esc(r.id)}" value="${loan}"></td><td>${r.hasActiveLoan?`<label><input type="checkbox" name="skipLoan_${esc(r.id)}" data-skip-manual-loan="${esc(r.id)}"> Skip loan</label>`:'—'}</td><td><strong data-net-pay>${money(Math.max(0,gross-ded-loan))}</strong></td></tr>`}).join(''):'<tr><td colspan="6">No active staff found for this business.</td></tr>'}</tbody></table></div></form>`,'manual-total'));
    document.querySelectorAll('[data-skip-manual-loan]').forEach(box=>box.addEventListener('change',()=>{const row=box.closest('tr');const loanInput=row.querySelector('input[name^="loanRepaymentAmount_"]');const original=Number(loanInput.dataset.original||loanInput.value||0);if(!loanInput.dataset.original)loanInput.dataset.original=String(original);const amount=box.checked?0:original;loanInput.value=String(amount);row.querySelector('[data-loan-amount]').textContent=money(amount);const gross=Number(row.querySelector('input[name^="grossAmount_"]').value||0),ded=Number(row.querySelector('input[name^="deductionAmount_"]').value||0);row.querySelector('[data-net-pay]').textContent=money(Math.max(0,gross-ded-amount));}));
    document.querySelectorAll('[data-close-payroll]').forEach(x=>x.addEventListener('click',close));
    const save=document.querySelector('[data-save-payroll]');
    save?.addEventListener('click',async()=>{
      const f=document.querySelector('#payroll-form'); if(!f||!f.reportValidity())return;
      const data=Object.fromEntries(new FormData(f).entries());
      const staffAdjustments=rows.map(r=>({staffId:r.id,grossAmount:Number(data[`grossAmount_${r.id}`]||0),deductionAmount:Number(data[`deductionAmount_${r.id}`]||0),loanRepaymentAmount:Number(data[`loanRepaymentAmount_${r.id}`]||0),deductionApplied:Number(data[`deductionAmount_${r.id}`]||0)>0,loanApplied:Number(data[`loanRepaymentAmount_${r.id}`]||0)>0}));
      save.disabled=true;
      try{await api('/api/payroll/monthly-total',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId, payrollMonth:month, amount:Number(data.amount),note:data.note||null,staffAdjustments})});close();await load();window.ReportGen.render();}catch(e){save.disabled=false;document.querySelector('#payroll-modal .modal-content')?.insertAdjacentHTML('beforeend',`<div class="notice error">${esc(e.message)}</div>`);}
    },{once:true});
  }catch(e){toast(e.message)}
}

function openSkipLoanModal(loanId){
  show(form('Skip loan repayment month',`<form id="payroll-form"><input type="hidden" name="loanId" value="${esc(loanId)}"><div class="form-grid"><label class="field"><span>Skip month</span><input class="input" name="skipMonth" type="month" value="${esc(month)}" required></label><label class="field" style="grid-column:1/-1"><span>Reason (optional)</span><textarea class="input" name="reason" placeholder="Why is this repayment being skipped?"></textarea></label></div><div class="notice">The skipped month will not create a repayment. If the loan has an end date, its period will be extended by one month.</div></form>`,'skip-loan','Skip month'));
  document.querySelectorAll('[data-close-payroll]').forEach(x=>x.addEventListener('click',close));
  document.querySelector('[data-save-payroll]')?.addEventListener('click',async()=>{const f=document.querySelector('#payroll-form');if(!f||!f.reportValidity())return;const d=Object.fromEntries(new FormData(f).entries());try{await api(`/api/payroll/loans/${encodeURIComponent(d.loanId)}/skip`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skipMonth:d.skipMonth,reason:d.reason||null})});close();await load();window.ReportGen.render();}catch(e){document.querySelector('#payroll-modal .modal-content')?.insertAdjacentHTML('beforeend',`<div class="notice error">${esc(e.message)}</div>`);}} ,{once:true});
}

export async function bindPayrollPage(){if(month!==state.dashboardMonth){month=state.dashboardMonth;loaded=false;}if(!loaded){load().then(()=>window.ReportGen.render());return;}document.querySelector('[data-refresh-payroll]')?.addEventListener('click',()=>load().then(()=>window.ReportGen.render()));document.querySelectorAll('[data-generate-payroll]').forEach(b=>b.addEventListener('click',async()=>{try{const d=await api('/api/payroll/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId:b.dataset.generatePayroll,payrollMonth:month})});await load();window.ReportGen.render();if(d.id)await openPayroll(d.id,b.dataset.generatePayroll)}catch(e){toast(e.message)}}));document.querySelectorAll('[data-view-payroll]').forEach(b=>b.addEventListener('click',()=>openPayroll(b.dataset.viewPayroll,b.dataset.businessId)));document.querySelectorAll('[data-delete-payroll]').forEach(b=>b.addEventListener('click',async()=>{if(!await customConfirm('Delete payroll', 'Delete this payroll and its employee entries?', 'Delete', true))return;try{await api(`/api/payroll/${encodeURIComponent(b.dataset.deletePayroll)}`,{method:'DELETE'});await load();window.ReportGen.render()}catch(e){toast(e.message)}}));document.querySelectorAll('[data-manual-payroll]').forEach(b=>b.addEventListener('click',()=>openManualPayrollModal(b.dataset.manualPayroll)));document.querySelectorAll('[data-record-payroll-payment]').forEach(b=>b.addEventListener('click',()=>openPaymentModal(b.dataset.recordPayrollPayment,b.dataset.businessName)));document.querySelectorAll('[data-view-payroll-payments]').forEach(b=>b.addEventListener('click',()=>openPaymentHistoryModal(b.dataset.viewPayrollPayments,b.dataset.businessName)));document.querySelector('[data-new-staff]')?.addEventListener('click',openStaffModal);document.querySelectorAll('[data-edit-staff]').forEach(b=>b.addEventListener('click',()=>openStaffEdit(b.dataset.editStaff)));document.querySelectorAll('[data-status-staff]').forEach(b=>b.addEventListener('click',()=>changeStaffStatus(b.dataset.statusStaff)));document.querySelectorAll('[data-deduction-staff]').forEach(b=>b.addEventListener('click',()=>openDeductionModal(b.dataset.deductionStaff)));document.querySelectorAll('[data-loan-staff]').forEach(b=>b.addEventListener('click',()=>openLoanModal(b.dataset.loanStaff)));document.querySelectorAll('[data-skip-loan]').forEach(b=>b.addEventListener('click',()=>openSkipLoanModal(b.dataset.skipLoan)))}
export function bindStaffPage(){if(!loaded){load().then(()=>window.ReportGen.render());return;}document.querySelector('[data-refresh-staff]')?.addEventListener('click',()=>load().then(()=>window.ReportGen.render()));document.querySelector('[data-new-staff]')?.addEventListener('click',openStaffModal);document.querySelector('[data-increase-salaries]')?.addEventListener('click',openSalaryIncreaseModal);document.querySelectorAll('[data-edit-staff]').forEach(b=>b.addEventListener('click',()=>openStaffEdit(b.dataset.editStaff)));document.querySelectorAll('[data-status-staff]').forEach(b=>b.addEventListener('click',()=>changeStaffStatus(b.dataset.statusStaff)));document.querySelectorAll('[data-delete-staff]').forEach(b=>b.addEventListener('click',()=>deleteStaff(b.dataset.deleteStaff)));document.querySelectorAll('[data-deduction-staff]').forEach(b=>b.addEventListener('click',()=>openDeductionModal(b.dataset.deductionStaff)));document.querySelectorAll('[data-loan-staff]').forEach(b=>b.addEventListener('click',()=>openLoanModal(b.dataset.loanStaff)));document.querySelectorAll('[data-skip-loan]').forEach(b=>b.addEventListener('click',()=>openSkipLoanModal(b.dataset.skipLoan)))}
function openStaffModal(){show(form('Create staff',`<form id="payroll-form"><div class="form-grid"><label class="field"><span>Business</span><select class="select" name="businessId" required>${businessOptions()}</select></label><label class="field"><span>Full name</span><input class="input" name="employeeName" required></label><div class="field"><span>Staff ID</span><div class="small">Generated automatically from the company prefix.</div></div><label class="field"><span>Department</span><select class="select" name="departmentId" required><option value="">Select department</option>${departments.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label><label class="field"><span>Job role</span><select class="select" name="roleId" required><option value="">Select job role</option>${jobRoles.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label>${canSeeSalaries()?`<label class="field"><span>Base salary</span><input class="input" name="baseSalary" type="number" min="0" step="0.01" required></label>`:''}<label class="field"><span>Linked login account (optional)</span><select class="select" name="linkedUserId">${userOptions()}</select><span class="small">Use this to connect a manager or other existing user to this staff record.</span></label></div></form>`,'staff'));bindModal()}
function openDeductionModal(staffId){show(form('Record staff deduction',`<form id="payroll-form"><input type="hidden" name="staffId" value="${esc(staffId)}"><div class="form-grid"><label class="field"><span>Gross payroll amount (calculated externally)</span><input class="input" name="amount" type="number" min="0" step="0.01" required></label><label class="field"><span>Category</span><input class="input" name="category" placeholder="Other deduction" required></label><label class="field"><span>Start month</span><input class="input" name="startMonth" type="month" value="${esc(month)}" required></label><label class="field"><span>End month (optional)</span><input class="input" name="endMonth" type="month"></label><label class="field" style="grid-column:1/-1"><span>Note</span><textarea class="input" name="note"></textarea></label></div></form>`,'deduction'));bindModal()}
function openLoanModal(staffId){show(form('Record staff loan',`<form id="payroll-form"><input type="hidden" name="staffId" value="${esc(staffId)}"><div class="form-grid"><label class="field"><span>Loan amount</span><input class="input" name="principalAmount" type="number" min="0.01" step="0.01" required></label><label class="field"><span>Monthly repayment</span><input class="input" name="monthlyAmount" type="number" min="0.01" step="0.01" required></label><label class="field"><span>Start month</span><input class="input" name="startMonth" type="month" value="${esc(month)}" required></label><label class="field"><span>End month (optional)</span><input class="input" name="endMonth" type="month"></label><label class="field" style="grid-column:1/-1"><span>Note</span><textarea class="input" name="note"></textarea></label></div></form>`,'loan'));bindModal()}
async function load(){
  loadErrors=[];
  const part=async(label,allowed,request,fallback)=>{if(!allowed)return fallback;try{return await request()}catch(e){loadErrors.push(`${label}: ${e.message||'could not be loaded.'}`);return fallback}};
  const anyStaffAccess=can('staff.view')||can('payroll.view')||can('payroll.deductions')||can('payroll.create')||can('payroll.edit');
  const [s,b,d,r,m,l,u]=await Promise.all([
    part('Staff list',anyStaffAccess,()=>api('/api/payroll/staff'),{staff:[]}),
    part('Businesses',true,()=>api('/api/businesses'),{businesses:[]}),
    part('Departments',canManage(),()=>api('/api/organization/departments'),{departments:[]}),
    part('Job roles',canManage(),()=>api('/api/organization/job-roles'),{jobRoles:[]}),
    part('Payroll totals',can('payroll.view'),()=>api(`/api/payroll/monthly?month=${encodeURIComponent(month)}`),{businesses:[]}),
    part('Loans',canManageLoans(),()=>api('/api/payroll/loans'),{loans:[]}),
    part('User accounts',canManage()&&can('users.manage'),()=>api('/api/users'),{users:[]})
  ]);
  staff=s.staff||[];businesses=b.businesses||b||[];loans=l.loans||[];users=u.users||[];departments=(d.departments||[]).filter(x=>x.isActive!==false);jobRoles=(r.jobRoles||[]).filter(x=>x.isActive!==false);monthly=m.businesses||[];loaded=true;
}
export {load};

let deductionPageLoaded=false, deductionPageStaff=[], deductionPageRows=[], deductionPageBusinesses=[];
export function deductionsPage(){
  const selectedMonth=state.dashboardMonth||month;
  if(month!==selectedMonth){month=selectedMonth;deductionPageLoaded=false;}
  const rows=deductionPageRows;
  return pageShell('Staff Deductions',`<div class="page-intro"><div><div class="eyebrow">Accountant workspace</div><h2>Staff deductions</h2><p>Record one-time or recurring deductions for staff assigned to your businesses. Staff directory details are not displayed.</p></div><div class="small">${esc(monthName(month))}</div></div><section class="panel"><div class="panel-head"><div><h3>Deduction records</h3><p>Use the record button to select a business, find a staff member and enter a deduction.</p></div><div class="button-row"><button class="btn" data-refresh-deductions>Refresh</button><button class="btn primary" data-record-deduction>Record deduction</button></div></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Staff</th><th>Business</th><th>Category</th><th>Amount</th><th>Period</th><th>Note</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.employeeName||'')}</strong><div class="small">${esc(r.employeeCode||'—')}</div></td><td>${esc(r.businessName||'')}</td><td>${esc(r.category||'')}</td><td>${money(r.amount||0)}</td><td>${esc(r.startMonth||'')} – ${esc(r.endMonth||'Ongoing')}</td><td>${esc(r.note||'—')}</td><td><button class="btn small danger" data-delete-deduction="${esc(r.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No deductions recorded for this reporting month.</div>'}</section>`);
}
function accountantDeductionModal(){
  const businesses=deductionPageBusinesses.length?deductionPageBusinesses:[];
  const businessOptions=businesses.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  show(`<div class="modal-backdrop" id="accountant-deduction-modal"><div class="modal modal-scroll compact-deduction-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">Accountant workspace</div><h3>Record staff deduction</h3></div><button class="btn ghost" data-close-accountant-deduction aria-label="Close">✕</button></div><div class="modal-content"><form id="accountant-deduction-form"><div class="form-grid"><label class="field" style="grid-column:1/-1"><span>Business</span><select class="select" name="businessId" id="deduction-business" required><option value="">Select business</option>${businessOptions}</select></label><label class="field" style="grid-column:1/-1"><span>Search staff</span><input class="input" id="deduction-staff-search" placeholder="Search by name or Staff ID" autocomplete="off" disabled></label><div id="deduction-staff-results" style="grid-column:1/-1"><div class="small">Select a business to search for staff.</div></div><div id="deduction-selected-staff" style="grid-column:1/-1"></div><input type="hidden" name="staffId" id="deduction-staff-id" required><label class="field"><span>Amount</span><input class="input" name="amount" type="number" min="0.01" step="0.01" required></label><label class="field"><span>Category</span><input class="input" name="category" value="Other deduction" required></label><label class="field"><span>Start month</span><input class="input" name="startMonth" type="month" value="${esc(month)}" required></label><label class="field"><span>End month (optional)</span><input class="input" name="endMonth" type="month"></label><label class="field" style="grid-column:1/-1"><span>Note (optional)</span><textarea class="input" name="note" rows="2"></textarea></label></div></form></div><div class="modal-actions"><button class="btn" data-close-accountant-deduction>Cancel</button><button class="btn primary" id="save-accountant-deduction">Save deduction</button></div></div></div>`);
  const modal=document.querySelector('#accountant-deduction-modal');
  const form=modal.querySelector('#accountant-deduction-form');
  const business=modal.querySelector('#deduction-business');
  const search=modal.querySelector('#deduction-staff-search');
  const results=modal.querySelector('#deduction-staff-results');
  const selected=modal.querySelector('#deduction-selected-staff');
  const staffId=modal.querySelector('#deduction-staff-id');
  const close=()=>modal.remove();
  modal.querySelectorAll('[data-close-accountant-deduction]').forEach(b=>b.addEventListener('click',close));
  let chosenBusiness='';
  const renderResults=()=>{
    const q=String(search.value||'').trim().toLowerCase();
    const matches=deductionPageStaff.filter(s=>String(s.businessId)===String(chosenBusiness)&&[s.employeeName,s.employeeCode].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,30);
    results.innerHTML=matches.length?matches.map(s=>`<button type="button" class="btn" style="width:100%;display:flex;justify-content:space-between;align-items:center;margin-top:7px;text-align:left" data-select-deduction-staff="${esc(s.id)}"><span><strong>${esc(s.employeeName)}</strong><span class="small">${esc(s.employeeCode||'—')}</span></span><span>Choose</span></button>`).join(''):'<div class="empty">No matching staff found.</div>';
  };
  const clearSelection=()=>{staffId.value='';selected.innerHTML='';};
  business.addEventListener('change',()=>{chosenBusiness=business.value;clearSelection();search.value='';search.disabled=!chosenBusiness;results.innerHTML=chosenBusiness?'<div class="small">Search by staff name or Staff ID.</div>':'<div class="small">Select a business to search for staff.</div>';if(chosenBusiness)search.focus();});
  search.addEventListener('input',renderResults);
  results.addEventListener('click',e=>{const button=e.target.closest('[data-select-deduction-staff]');if(!button)return;const s=deductionPageStaff.find(x=>String(x.id)===String(button.dataset.selectDeductionStaff));if(!s)return;staffId.value=s.id;selected.innerHTML=`<div class="notice success"><strong>Selected:</strong> ${esc(s.employeeName)} <span class="small">${esc(s.employeeCode||'—')} · ${esc(s.businessName||'')}</span></div>`;results.innerHTML='';});
  modal.querySelector('#save-accountant-deduction').addEventListener('click',async()=>{if(!form.reportValidity())return;if(!staffId.value){toast('Select a staff member first.');return;}const d=Object.fromEntries(new FormData(form).entries());if(d.endMonth && d.endMonth<d.startMonth){toast('End month cannot be earlier than start month.');return;}const save=modal.querySelector('#save-accountant-deduction');save.disabled=true;save.textContent='Saving…';try{await api('/api/payroll/deductions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...d,amount:Number(d.amount),endMonth:d.endMonth||null})});close();await refreshDeductions();}catch(e){save.disabled=false;save.textContent='Save deduction';modal.querySelector('.modal-content')?.insertAdjacentHTML('afterbegin',`<div class="notice error">${esc(e.message)}</div>`);}});
}
async function refreshDeductions(){
  const [s,d,b]=await Promise.all([api('/api/payroll/staff'),api(`/api/payroll/deductions?month=${encodeURIComponent(month)}`),api('/api/businesses')]);
  deductionPageStaff=s.staff||[];deductionPageRows=d.deductions||[];
  const allBusinesses=b.businesses||b||[];
  const assignedIds=new Set(deductionPageStaff.map(s=>String(s.businessId)));
  deductionPageBusinesses=allBusinesses.filter(x=>assignedIds.has(String(x.id)));
  deductionPageLoaded=true;window.ReportGen.render();
}
export function bindDeductionsPage(){
  if(!deductionPageLoaded){refreshDeductions().catch(e=>toast(e.message));return;}
  document.querySelector('[data-refresh-deductions]')?.addEventListener('click',()=>{deductionPageLoaded=false;window.ReportGen.render()});
  document.querySelector('[data-record-deduction]')?.addEventListener('click',accountantDeductionModal);
  document.querySelectorAll('[data-delete-deduction]').forEach(b=>b.addEventListener('click',async()=>{if(!await customConfirm('Delete deduction','Delete this deduction record?','Delete',true))return;try{await api(`/api/payroll/deductions/${encodeURIComponent(b.dataset.deleteDeduction)}`,{method:'DELETE'});await refreshDeductions();}catch(e){toast(e.message)}}));
}
