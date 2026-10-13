import {state,esc,money,normalizedRole,isLimitedRole,dateRangeLabel} from '../state.js';
import {api} from '../api.js';
import {pageShell,toast} from '../components/ui.js';

let loadedKey='';
let currentRows=[];
let previousRows=[];
let loading=false;
let managerReportBusinessId='';

const n=v=>Number(v||0);
const monthDefault=()=>state.dashboardMonth||new Date().toISOString().slice(0,7);
const monthLabel=month=>new Date(`${month}-01T12:00:00`).toLocaleDateString('en-NG',{month:'long',year:'numeric'});
const daysInMonth=month=>{const [year,monthNumber]=String(month).split('-').map(Number);return new Date(Date.UTC(year,monthNumber,0)).getUTCDate();};
const previousMonth=month=>{const d=new Date(`${month}-01T12:00:00`);d.setMonth(d.getMonth()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
const pct=(current,previous)=>previous===0?(current===0?'—':'New'):`${((current-previous)/Math.abs(previous)*100).toFixed(1)}%`;
const deltaClass=(current,previous,inverse=false)=>{if(previous===0||current===previous)return '';const positive=current>previous;return (inverse?!positive:positive)?'positive':'negative';};
const delta=(current,previous,inverse=false,options={})=>{if(options.noData)return '<span class="report-delta muted">— No current data</span>';if(options.noActivity)return '<span class="report-delta muted">— No recorded activity</span>';return `<span class="report-delta ${deltaClass(current,previous,inverse)}">${current>previous?'↑':current<previous?'↓':'→'} ${pct(current,previous)}</span>`;};
const metric=(label,value,note='',kind='currency')=>{const isCurrency=kind==='currency';return `<div class="kpi"><div class="kpi-top"><span>${esc(label)}</span>${isCurrency?'<span class="kpi-icon">₦</span>':''}</div><div class="kpi-value">${typeof value==='string'?esc(value):isCurrency?money(value):esc(String(value))}</div>${note?`<div class="kpi-note">${note}</div>`:''}</div>`;};
const table=(headers,rows,total='')=>`<div class="table-wrap report-table-wrap"><table class="report-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}${total}</tbody></table></div>`;
const empty=(message)=>`<div class="report-empty" role="status"><span>${esc(message)}</span></div>`;
const managerBusinessId=row=>String(row.business?.id||row.businessId||'');
function scopedManagerRows(rows){return managerReportBusinessId?rows.filter(row=>managerBusinessId(row)===managerReportBusinessId):rows;}
function managerScopeName(){return managerReportBusinessId?state.businesses.find(b=>String(b.id)===managerReportBusinessId)?.name||'Selected business':'All assigned businesses';}

function aggregate(rows){
  const out={sales:0,gross:0,returns:0,transactions:0,costOfGoods:0,grossProfit:0,expenses:0,payroll:0,totalExpenses:0,netProfit:0,purchases:0,averageSale:0,daysWithSales:0};
  for(const r of rows){const s=r.summary||{},f=r.financials||{};for(const key of ['sales','gross','returns','transactions'])out[key]+=n(s[key]);for(const key of ['costOfGoods','grossProfit','expenses','payroll','totalExpenses','netProfit','purchases'])out[key]+=n(f[key]);out.daysWithSales+=n(r.customerFlow?.daysWithSales);}
  out.averageSale=out.transactions?out.sales/out.transactions:0;
  out.grossMargin=out.sales?out.grossProfit/out.sales*100:0;
  out.netMargin=out.sales?out.netProfit/out.sales*100:0;
  out.returnRate=out.gross?out.returns/out.gross*100:0;
  return out;
}
function combineList(rows,field,valueField){
  const map=new Map();
  for(const r of rows){for(const item of (r[field]||[])){const key=item[valueField]||item.productName||item.category||'Unspecified';const x=map.get(key)||{name:key,sales:0,quantity:0,transactions:0,profit:0};x.sales+=n(item.sales);x.quantity+=n(item.quantity);x.transactions+=n(item.transactions);x.profit+=n(item.profit);map.set(key,x);}}
  return [...map.values()];
}
function dailySeries(rows){
  const map=new Map();
  for(const r of rows){for(const d of (r.customerFlow?.daily||[])){const x=map.get(d.day)||{day:d.day,sales:0,transactions:0};x.sales+=n(d.sales);x.transactions+=n(d.transactions);map.set(d.day,x);}}
  return [...map.values()].sort((a,b)=>a.day.localeCompare(b.day));
}
function expenseRows(rows){
  const map=new Map();
  for(const r of rows){for(const e of (r.expenses||[])){const key=e.category||e.description||'Other';map.set(key,(map.get(key)||0)+n(e.amount));}}
  return [...map.entries()].sort((a,b)=>b[1]-a[1]);
}
function businessRows(rows,previous,noCurrentData=false){
  const previousMap=new Map(previous.map(r=>[r.business?.id,r]));
  return rows.map(r=>{const s=r.summary||{},f=r.financials||{},p=previousMap.get(r.business?.id)||{};const ps=p.summary||{},pf=p.financials||{};return `<tr><td><strong>${esc(r.business?.name||'Business')}</strong></td><td>${money(s.sales)}</td><td>${money(f.grossProfit)}</td><td>${money(f.expenses)}</td><td>${money(f.payroll)}</td><td>${money(f.netProfit)}</td><td>${n(s.transactions).toLocaleString()}</td><td>${delta(n(s.sales),n(ps.sales))}</td></tr>`;});
}
function dailyChart(rows){
  const daily=dailySeries(rows);if(!daily.length)return empty('No daily sales data available for this period.');
  const max=Math.max(...daily.map(d=>d.sales),1);const width=960,height=300,left=58,right=20,bottom=42,top=22,chartH=height-top-bottom,chartW=width-left-right;const slot=chartW/daily.length;const barW=Math.max(4,slot*.62);
  const grid=[0,.25,.5,.75,1].map(r=>{const y=top+chartH-chartH*r;return `<line x1="${left}" y1="${y.toFixed(2)}" x2="${width-right}" y2="${y.toFixed(2)}" class="report-chart-grid"></line><text x="${left-10}" y="${(y+4).toFixed(2)}" text-anchor="end" class="report-chart-label">${money(max*r).replace('.00','')}</text>`;}).join('');
  const bars=daily.map((d,i)=>{const h=d.sales/max*chartH;const x=left+i*slot+(slot-barW)/2;const y=top+chartH-h;const showLabel=i===0||i===daily.length-1||i%5===0;return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(1,h).toFixed(2)}" rx="3" class="report-chart-bar"><title>${esc(d.day)}: ${esc(money(d.sales))}</title></rect>${showLabel?`<text x="${(x+barW/2).toFixed(2)}" y="${height-16}" text-anchor="middle" class="report-chart-label">${esc(String(d.day).slice(-2))}</text>`:''}`;}).join('');
  return `<div class="report-chart-frame sales-trend-chart"><div class="chart-legend"><span class="legend-dot"></span><span>Daily sales</span><span class="chart-note">Hover bars for exact values</span></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily sales trend" class="report-contribution-chart">${grid}<line x1="${left}" y1="${top+chartH}" x2="${width-right}" y2="${top+chartH}" class="report-chart-axis"></line>${bars}</svg></div>`;
}
function horizontalChart(items,labelKey,valueKey,limit=10){
  const top=[...items].sort((a,b)=>n(b[valueKey])-n(a[valueKey])).slice(0,limit);if(!top.length)return empty('No data available for this section.');const max=Math.max(...top.map(x=>n(x[valueKey])),1);
  return `<div class="manager-bars">${top.map(x=>`<div class="manager-bar-row"><div class="manager-bar-label"><span>${esc(x[labelKey])}</span><strong>${money(x[valueKey])}</strong></div><div class="manager-bar-track"><div class="manager-bar-fill" style="width:${(n(x[valueKey])/max*100).toFixed(2)}%"></div></div></div>`).join('')}</div>`;
}
function comparisonTable(current,previous,noCurrentData=false){const metrics=[['Sales','sales'],['Cost of goods','costOfGoods'],['Gross profit','grossProfit'],['Expenses','expenses'],['Payroll','payroll'],['Net profit','netProfit'],['Purchases','purchases'],['Transactions','transactions']];return table(['Metric','Current month','Previous month','Change'],metrics.map(([label,key])=>`<tr><td><strong>${label}</strong></td><td>${key==='transactions'?n(current[key]).toLocaleString():money(current[key])}</td><td>${key==='transactions'?n(previous[key]).toLocaleString():money(previous[key])}</td><td>${delta(n(current[key]),n(previous[key]),key==='costOfGoods'||key==='expenses'||key==='payroll'||key==='purchases',{noData:noCurrentData})}</td></tr>`));}
const managerReportSections=[
  ['intro','Introduction Commentary'],['summary','Executive Financial Summary'],['comparison','Current Month vs Previous Month'],['sales','Sales Trend'],['selling','Top 10 Selling Products'],['profitable','Top 10 Profitable Products'],['groups','Product Group Sales Performance'],['returns','Sales Return Report'],['expenses','Expense Details'],['businesses','Assigned Business Contribution'],['payroll','Payroll Summary'],['commentary','Management Commentary']
];
const managerSectionControls=()=>`<div class="report-section-controls print-control" aria-label="Report sections"><strong>Include sections:</strong>${managerReportSections.map(([key,label])=>`<label><input type="checkbox" data-manager-section="${key}" checked> ${esc(label)}</label>`).join('')}</div>`;
function managerSelectedSections(){return [...document.querySelectorAll('[data-manager-section]')].filter(input=>input.checked).map(input=>input.dataset.managerSection);}
function managerApplySectionVisibility(){const selected=new Set(managerSelectedSections());document.querySelectorAll('.manager-report-root [data-report-section]').forEach(section=>section.classList.toggle('report-section-hidden',!selected.has(section.dataset.reportSection)));}
async function exportManagerReport(format){
  const selected=new Set(managerSelectedSections());
  const scopedCurrent=scopedManagerRows(currentRows),scopedPrevious=scopedManagerRows(previousRows);
  const sections=[...document.querySelectorAll('.manager-report-root [data-report-section]')].filter(section=>selected.has(section.dataset.reportSection)).map(section=>({key:section.dataset.reportSection,title:section.dataset.reportTitle||section.querySelector('h4')?.textContent||section.dataset.reportSection,html:section.innerHTML}));
  if(!sections.length){toast('Select at least one report section to export.');return;}
  const button=document.getElementById(format==='excel'?'managerExportExcel':'managerExportWord');if(button)button.disabled=true;
  try{
    const headers={'Content-Type':'application/json'};if(state.csrf)headers['x-csrf-token']=state.csrf;
    const payload={companyName:state.company?.name||'ReportGen',label:document.querySelector('.manager-report-root .report-brand p')?.textContent||'Selected period',scopeName:managerScopeName(),preparedBy:state.user?.displayName||state.user?.username||'Business Manager',month:monthDefault(),businessIds:[...new Set(scopedCurrent.map(r=>managerBusinessId(r)).filter(Boolean))],rows:scopedCurrent.map(r=>({businessId:managerBusinessId(r),summary:r.summary,financials:r.financials})),dailyTrend:dailySeries(scopedCurrent),sections};
    const validation=await fetch('/api/reports/export/manager/validate',{method:'POST',headers,body:JSON.stringify(payload)});
    if(!validation.ok){let message='Export validation failed.';try{const body=await validation.json();message=body.error||message;}catch{}throw new Error(message);}
    const response=await fetch(`/api/reports/export/manager/${format}`,{method:'POST',headers,body:JSON.stringify(payload)});
    if(!response.ok){let message='Export failed.';try{const body=await response.json();message=body.error||message;}catch{}throw new Error(message);}
    const blob=await response.blob();const disposition=response.headers.get('content-disposition')||'';const match=disposition.match(/filename="?([^";]+)"?/i);const filename=match?.[1]||`ReportGen-Business-Manager.${format==='excel'?'xlsx':'doc'}`;const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);toast(`${format==='excel'?'Excel':'Word'} export generated with selected sections.`);
  }catch(error){console.error('Business Manager report export failed:',error);toast(error.message||'Export failed.');}finally{if(button)button.disabled=false;}
}
function reportBody(month,current,previous){
  const t=aggregate(current),p=aggregate(previous);const noCurrentData=t.transactions===0&&t.sales===0&&t.gross===0;const noPreviousData=p.transactions===0&&p.sales===0&&p.gross===0;const salesDays=daysInMonth(month);const products=combineList(current,'topProducts','productName').sort((a,b)=>b.sales-a.sales).slice(0,10);const profitable=combineList(current,'topProfitable','productName').sort((a,b)=>b.profit-a.profit).slice(0,10);const groups=combineList(current,'categories','category').sort((a,b)=>b.sales-a.sales);const expenses=expenseRows(current);const previousLabel=monthLabel(previousMonth(month));
  const highest=dailySeries(current).sort((a,b)=>b.sales-a.sales)[0];const lowest=dailySeries(current).filter(d=>n(d.sales)>0).sort((a,b)=>a.sales-b.sales)[0];
  return `<div class="report-print-root manager-report-root">
    ${noCurrentData?`<div class="report-data-notice"><strong>No current-month sales activity recorded.</strong><span>Figures are shown as returned by the selected source records. Confirm the import and reporting period before using month-on-month comparisons.</span></div>`:''}
    <div class="report-header"><div class="report-brand"><div class="eyebrow">Business Manager workspace</div><h2>Financial & Business Performance Report — ${esc(managerScopeName())}</h2><p>${esc(state.company?.name||'ReportGen')} · ${esc(monthLabel(month))} · Compared with ${esc(previousLabel)}</p><p>${esc(managerScopeName())} · Report scope · Prepared by ${esc(state.user?.displayName||state.user?.username||'Business Manager')}</p></div><div class="print-control actions"><button class="btn secondary" id="managerExportWord">Export Word</button><button class="btn secondary" id="managerExportExcel">Export Excel</button><button class="btn primary" id="managerPrintReport">Print report</button></div></div>${managerSectionControls()}
    <section class="report-section" data-report-section="intro" data-report-title="Introduction Commentary"><div class="report-section-head"><div><h4>Introduction Commentary</h4><p>Summary of the selected reporting period and the month-on-month movement.</p></div></div><p class="report-note">This report summarizes business performance for ${esc(monthLabel(month))}, with a comparison against ${esc(previousLabel)}. Figures are limited to ${esc(managerScopeName())}.</p></section>
    <section class="report-section executive-summary-section" data-report-section="summary" data-report-title="Executive Financial Summary"><div class="report-section-head"><div><h4>Executive Financial Summary</h4><p>Current-month financial health, profitability, and operating activity compared with the previous month.</p></div><span class="section-badge">Management view</span></div><div class="summary-group-label">Financial performance</div><div class="kpis summary-kpis">${metric('Total sales',t.sales,delta(t.sales,p.sales,false,{noData:noCurrentData}))}${metric('Cost of goods',t.costOfGoods,delta(t.costOfGoods,p.costOfGoods,true,{noData:noCurrentData}))}${metric('Gross profit',t.grossProfit,delta(t.grossProfit,p.grossProfit,false,{noData:noCurrentData}))}${metric('Net profit',t.netProfit,delta(t.netProfit,p.netProfit,false,{noData:noCurrentData}))}${metric('Total expenses',t.expenses,delta(t.expenses,p.expenses,true,{noData:noCurrentData}))}${metric('Payroll',t.payroll,delta(t.payroll,p.payroll,true,{noData:noCurrentData}))}</div><div class="summary-group-label">Operating indicators</div><div class="kpis summary-kpis summary-kpis-secondary">${metric('Gross margin',`${t.grossMargin.toFixed(1)}%`,'','percentage')}${metric('Net margin',`${t.netMargin.toFixed(1)}%`,'','percentage')}${metric('Transactions',t.transactions.toLocaleString(),delta(t.transactions,p.transactions,false,{noData:noCurrentData}),'count')}${metric('Average sale',t.averageSale,'','currency')}${metric('Returns',t.returns,delta(t.returns,p.returns,true,{noData:noCurrentData}),'currency')}${metric('Return rate',`${t.returnRate.toFixed(2)}%`,'','percentage')}</div></section>
    <section class="report-section" data-report-section="comparison" data-report-title="Current Month vs Previous Month"><div class="report-section-head"><div><h4>Current Month vs Previous Month</h4><p>Absolute values and percentage changes for the assigned business scope.</p></div></div>${comparisonTable(t,p,noCurrentData)}</section>
    <section class="report-section" data-report-section="sales" data-report-title="Sales Trend"><div class="report-section-head"><div><h4>Sales Trend</h4><p>Daily sales activity for ${esc(monthLabel(month))}.</p></div></div>${dailyChart(current)}<div class="report-card-grid"><div><span>Highest sales day</span><strong>${highest?esc(highest.day):'—'}</strong><small>${highest?money(highest.sales):'No data'}</small></div><div><span>Lowest sales day</span><strong>${lowest?esc(lowest.day):'—'}</strong><small>${lowest?money(lowest.sales):'No data'}</small></div><div><span>Sales days</span><strong>${salesDays.toLocaleString()}</strong><small>Calendar days in the selected month</small></div><div><span>Avg transaction</span><strong>${money(t.averageSale)}</strong><small>Sales divided by transactions</small></div></div></section>
    <section class="report-section" data-report-section="selling" data-report-title="Top 10 Selling Products"><div class="report-section-head"><div><h4>Top 10 Selling Products</h4><p>Ranked by sales value for the selected month.</p></div></div>${horizontalChart(products,'name','sales')} ${table(['Product','Quantity sold','Transactions','Sales'],products.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${n(x.quantity).toLocaleString()}</td><td>${n(x.transactions).toLocaleString()}</td><td>${money(x.sales)}</td></tr>`))}</section>
    <section class="report-section" data-report-section="profitable" data-report-title="Top 10 Profitable Products"><div class="report-section-head"><div><h4>Top 10 Profitable Products</h4><p>Ranked by recorded product profit. Products without reliable cost data may be excluded or require review.</p></div></div>${horizontalChart(profitable,'name','profit')} ${table(['Product','Sales','Recorded profit'],profitable.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${money(x.sales)}</td><td>${money(x.profit)}</td></tr>`))}</section>
    <section class="report-section" data-report-section="groups" data-report-title="Product Group Sales Performance"><div class="report-section-head"><div><h4>Product Group Sales Performance</h4><p>Sales grouped by the category values available in the source records.</p></div></div>${groups.length?table(['Group','Sales'],groups.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${money(x.sales)}</td></tr>`)):empty('No product group data available.')}</section>
    <section class="report-section" data-report-section="returns" data-report-title="Sales Return Report"><div class="report-section-head"><div><h4>Sales Return Report</h4><p>Return values and rates for the selected month.</p></div></div>${table(['Metric','Value'],[`<tr><td><strong>Total returns</strong></td><td>${money(t.returns)}</td></tr>`,`<tr><td><strong>Return rate</strong></td><td>${t.returnRate.toFixed(2)}%</td></tr>`,`<tr><td><strong>Previous month return rate</strong></td><td>${p.returnRate.toFixed(2)}%</td></tr>`,`<tr><td><strong>Return rate change</strong></td><td>${delta(t.returnRate,p.returnRate,true,{noData:noCurrentData})}</td></tr>`])}</section>
    <section class="report-section" data-report-section="expenses" data-report-title="Expense Details"><div class="report-section-head"><div><h4>Expense Details</h4><p>Expenses recorded for the selected month and assigned business scope.</p></div></div>${expenses.length?table(['Category','Amount'],expenses.map(([name,amount])=>`<tr><td><strong>${esc(name)}</strong></td><td>${money(amount)}</td></tr>`),`<tr class="total-row"><td><strong>Total expenses</strong></td><td>${money(t.expenses)}</td></tr>`):empty('No expense records available for this period.')}</section>
    <section class="report-section" data-report-section="businesses" data-report-title="Business Contribution"><div class="report-section-head"><div><h4>${esc(managerScopeName())} Contribution</h4><p>Performance for ${esc(managerScopeName())} during the selected month.</p></div></div>${table(['Business','Sales','Gross profit','Expenses','Payroll','Net profit','Transactions','Sales change'],businessRows(current,previous),`<tr class="total-row"><td><strong>${esc(managerScopeName())} total</strong></td><td>${money(t.sales)}</td><td>${money(t.grossProfit)}</td><td>${money(t.expenses)}</td><td>${money(t.payroll)}</td><td>${money(t.netProfit)}</td><td>${t.transactions.toLocaleString()}</td><td>${delta(t.sales,p.sales)}</td></tr>`)}</section>
    <section class="report-section" data-report-section="payroll" data-report-title="Payroll Summary"><div class="report-section-head"><div><h4>Payroll Summary</h4><p>Total payroll only; detailed staff salary, loan and deduction records are not exposed to Business Managers.</p></div></div>${table(['Metric','Current month','Previous month','Change'],[`<tr><td><strong>Total payroll</strong></td><td>${money(t.payroll)}</td><td>${money(p.payroll)}</td><td>${delta(t.payroll,p.payroll,true)}</td></tr>`])}</section>
    <section class="report-section" data-report-section="commentary" data-report-title="Management Commentary"><div class="report-section-head"><div><h4>Management Commentary</h4><p>Data-supported observations for the selected month.</p></div></div><ul class="report-note"><li>Sales were ${money(t.sales)} with ${t.transactions.toLocaleString()} recorded transactions.</li><li>Gross profit was ${money(t.grossProfit)} and net profit was ${money(t.netProfit)} based on the current ReportGen calculation rules.</li><li>Expenses were ${money(t.expenses)} and payroll was ${money(t.payroll)} for the selected month.</li><li>${noCurrentData?`No current-month sales activity was recorded for ${esc(monthLabel(month))}. Confirm that the month’s source records have been imported before interpreting the comparison.`:t.sales===p.sales?`Sales were unchanged compared with ${esc(previousLabel)}.`:t.sales>p.sales?`Sales increased compared with ${esc(previousLabel)} by ${esc(pct(t.sales,p.sales))}.`:`Sales decreased compared with ${esc(previousLabel)} by ${esc(pct(t.sales,p.sales))}.`}</li></ul></section>
    <div class="report-note small">Prepared by ${esc(state.user?.displayName||state.user?.username||'Business Manager')} · Generated ${esc(new Date().toLocaleDateString('en-NG'))}. Review source records before accounting, tax, or regulatory use.</div>
  </div>`;
}

export function managerReportsPage(){
  const month=monthDefault();
  if(loading)return pageShell('Reports','<div class="empty">Loading assigned business report…</div>');
  if(!loadedKey)return pageShell('Reports','<div class="empty">Preparing your assigned business report…</div>');
  const previous=previousMonth(month);
  const businessOptions=state.businesses.filter(b=>b.isActive!==0).map(b=>`<option value="${esc(b.id)}" ${String(b.id)===managerReportBusinessId?'selected':''}>${esc(b.name)}</option>`).join('');
  return pageShell('Reports',`<div class="page-intro report-controls"><div><div class="eyebrow">Business Manager workspace</div><h2>Full Financial Report</h2><p>Assigned business performance, financial summary, and month-on-month comparison.</p></div><div class="form-grid"><label class="field"><span>Business scope</span><select class="input" id="managerReportBusiness"><option value="">All assigned businesses</option>${businessOptions}</select></label><label class="field"><span>Reporting month</span><input class="input" id="managerReportMonth" type="month" value="${esc(month)}"></label></div></div>${reportBody(month,scopedManagerRows(currentRows),scopedManagerRows(previousRows))}`);
}

export function bindManagerReports(){
  if(!isLimitedRole())return;
  const month=monthDefault();
  const previous=previousMonth(month);
  const key=`${month}:${previous}:${(state.businesses||[]).map(b=>b.id).join(',')}`;
  const load=async()=>{
    loading=true;window.ReportGen.render();
    try{
      currentRows=[];previousRows=[];
      for(const business of state.businesses||[]){
        const [current,prior]=await Promise.all([
          api(`/api/businesses/${encodeURIComponent(business.id)}/details?month=${encodeURIComponent(month)}`),
          api(`/api/businesses/${encodeURIComponent(business.id)}/details?month=${encodeURIComponent(previous)}`)
        ]);
        currentRows.push(current);previousRows.push(prior);
      }
      loadedKey=key;
    }finally{loading=false;window.ReportGen.render();}
  };
  if(loading)return;
  if(loadedKey!==key){load().catch(e=>{loading=false;const box=document.querySelector('.content');if(box)box.innerHTML=`<div class="notice error">${esc(e.message||'Unable to load report.')}</div>`;});return;}
  document.getElementById('managerReportMonth')?.addEventListener('change',()=>{const value=document.getElementById('managerReportMonth').value;if(!/^\d{4}-\d{2}$/.test(value))return;state.dashboardMonth=value;loadedKey='';window.ReportGen.render();});
  document.getElementById('managerReportBusiness')?.addEventListener('change',event=>{managerReportBusinessId=event.target.value;window.ReportGen.render();});
  document.getElementById('managerPrintReport')?.addEventListener('click',()=>window.print());
  document.getElementById('managerExportWord')?.addEventListener('click',()=>exportManagerReport('word'));
  document.getElementById('managerExportExcel')?.addEventListener('click',()=>exportManagerReport('excel'));
  document.querySelectorAll('[data-manager-section]').forEach(input=>input.addEventListener('change',managerApplySectionVisibility));
  managerApplySectionVisibility();
}


// Business Manager operational pages: read-only, assigned-business scope only.
let managerStaffRows=[];
let managerExpenseRows=[];
let managerPayrollRows=[];
let managerOpsKey='';
const managerMonth=()=>state.dashboardMonth||new Date().toISOString().slice(0,7);
const managerMonthLabel=m=>new Date(`${m}-01T12:00:00`).toLocaleDateString('en-NG',{month:'long',year:'numeric'});
const managerTotal=(rows,key)=>rows.reduce((sum,row)=>sum+n(row[key]),0);
const managerOpsHeader=(eyebrow,title,description,month)=>`<div class="page-intro"><div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2><p>${esc(description)}</p></div><label class="field"><span>Reporting month</span><input class="input" type="month" id="managerOpsMonth" value="${esc(month)}"></label></div>`;

export function managerStaffPage(){
  return pageShell('Staff Management',`${managerOpsHeader('Business Manager workspace','Staff Management','Staff directory for your assigned business(es). Management actions and salary details are not shown.',managerMonth())}<section class="panel"><div class="panel-head"><div><h3>Staff directory</h3><p>Read-only list of staff belonging to your assigned business scope.</p></div><button class="btn" id="managerStaffRefresh">Refresh</button></div>${managerStaffRows.length?`<div class="table-wrap"><table><thead><tr><th>Staff ID</th><th>Name</th><th>Business</th><th>Role</th><th>Department</th><th>Status</th></tr></thead><tbody>${managerStaffRows.map(s=>`<tr><td><strong>${esc(s.employeeCode||'—')}</strong></td><td>${esc(s.employeeName||'—')}</td><td>${esc(s.businessName||'—')}</td><td>${esc(s.roleTitle||'—')}</td><td>${esc(s.department||'—')}</td><td>${esc(s.status||'—')}</td></tr>`).join('')}</tbody></table></div>`:empty('No staff records found for your assigned business scope.')}</section>`);
}
export function bindManagerStaff(){
  const load=async()=>{managerStaffRows=(await api('/api/payroll/staff')).staff||[];window.ReportGen.render();};
  document.getElementById('managerStaffRefresh')?.addEventListener('click',()=>load().catch(e=>toast(e.message)));
  document.getElementById('managerOpsMonth')?.addEventListener('change',e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){state.dashboardMonth=e.target.value;window.ReportGen.render();}});
  if(managerOpsKey!=='staff'){managerOpsKey='staff';load().catch(e=>{const box=document.querySelector('.content');if(box)box.innerHTML=`<div class="notice error">${esc(e.message||'Unable to load staff.')}</div>`;});}
}

export function managerExpensesPage(){
  const month=managerMonth();
  const total=managerExpenseRows.reduce((sum,row)=>sum+n(row.amount),0);
  return pageShell('Expenses',`${managerOpsHeader('Business Manager workspace','Expenses','Read-only expenses for the selected date range and assigned business scope.',month)}<section class="panel"><div class="panel-head"><div><h3>Expense summary</h3><p>${esc(dateRangeLabel())}</p></div><strong>${money(total)}</strong></div>${managerExpenseRows.length?`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Business</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>${managerExpenseRows.map(e=>`<tr><td>${esc(e.expenseDate||'—')}</td><td>${esc(e.businessName||'—')}</td><td>${esc(e.category||'—')}</td><td>${esc(e.description||'—')}</td><td>${money(e.amount)}</td></tr>`).join('')}</tbody></table></div>`:empty('No expenses recorded for this date range in your assigned business scope.')}</section>`);
}
export function bindManagerExpenses(){
  if(!isLimitedRole())return;
  const month=managerMonth();
  const rangeKey=`${state.dashboardStart}:${state.dashboardEnd}`;
  const load=async()=>{managerExpenseRows=(await api(`/api/manager/expenses?month=${encodeURIComponent(month)}&start=${encodeURIComponent(state.dashboardStart)}&end=${encodeURIComponent(state.dashboardEnd)}`)).expenses||[];window.ReportGen.render();};
  document.getElementById('managerOpsMonth')?.addEventListener('change',e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){state.dashboardMonth=e.target.value;window.ReportGen.render();}});
  if(managerOpsKey!==`expenses:${month}:${rangeKey}`){managerOpsKey=`expenses:${month}:${rangeKey}`;load().catch(e=>{const box=document.querySelector('.content');if(box)box.innerHTML=`<div class="notice error">${esc(e.message||'Unable to load expenses.')}</div>`;});}
}

export function managerPayrollPage(){
  const month=managerMonth();
  const total=managerTotal(managerPayrollRows,'payrollTotal');
  return pageShell('Payroll',`${managerOpsHeader('Business Manager workspace','Monthly Payroll','Total payroll for the selected month. Individual salaries, deductions and loan details are not displayed.',month)}<section class="panel"><div class="panel-head"><div><h3>Payroll totals</h3><p>${esc(managerMonthLabel(month))} · Assigned business scope only</p></div><strong>${money(total)}</strong></div>${managerPayrollRows.length?`<div class="table-wrap"><table><thead><tr><th>Business</th><th>Status</th><th>Payroll total</th></tr></thead><tbody>${managerPayrollRows.map(r=>`<tr><td><strong>${esc(r.businessName||'—')}</strong></td><td>${esc(r.payrollStatus||'Not created')}</td><td>${money(r.payrollTotal)}</td></tr>`).join('')}<tr class="total-row"><td colspan="2"><strong>Assigned total</strong></td><td><strong>${money(total)}</strong></td></tr></tbody></table></div>`:empty('No payroll records found for this month in your assigned business scope.')}</section>`);
}
export function bindManagerPayroll(){
  const month=managerMonth();
  const load=async()=>{managerPayrollRows=(await api(`/api/payroll/monthly?month=${encodeURIComponent(month)}`)).businesses||[];window.ReportGen.render();};
  document.getElementById('managerOpsMonth')?.addEventListener('change',e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){state.dashboardMonth=e.target.value;window.ReportGen.render();}});
  if(managerOpsKey!==`payroll:${month}`){managerOpsKey=`payroll:${month}`;load().catch(e=>{const box=document.querySelector('.content');if(box)box.innerHTML=`<div class="notice error">${esc(e.message||'Unable to load payroll.')}</div>`;});}
}
