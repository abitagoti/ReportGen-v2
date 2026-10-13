import {state,esc,money} from '../state.js';
import {pageShell,logo,modal,toast,canManageAdmin} from '../components/ui.js';
import {api,loadWorkspace} from '../api.js';

function issueMarkup(issues){
  return issues.map(i=>`<div class="issue-row"><div><span class="pill ${i.severity==='error'?'error':i.severity==='warning'?'warn':'success'}">${esc(i.severity||'info')}</span><strong>${esc(i.code||'Validation issue')}</strong></div><div class="small">Source row: ${esc(i.sourceRow??'—')} · ${esc(i.field||'General')}</div><p>${esc(i.message||'')}</p></div>`).join('');
}

async function openWarnings(id){
  try{
    const d=await api('/api/sales/imports/'+encodeURIComponent(id));
    const x=d.import||{};
    const issues=d.issues||[];
    const warningCount=Number(x.warning_count??x.warningCount??0);
    const errorCount=Number(x.error_count??x.errorCount??0);
    const content=issues.length
      ? `<div class="issue-list issue-list-expanded">${issueMarkup(issues)}</div>`
      : `<div class="empty"><strong>${warningCount.toLocaleString()} warning(s) recorded</strong><p class="small">This import was created before detailed warning records were stored. The total is preserved, but the original row-level warning messages are not available in the database.</p><p class="small">Re-importing the source file with the current validation engine will record each warning and exclusion for review.</p>${errorCount?`<p class="small">Recorded exclusions/errors: ${errorCount.toLocaleString()}</p>`:''}</div>`;
    modal('Warnings and exclusions',`<div class="import-detail-head"><div><div class="eyebrow">${esc(x.file_name||x.fileName||'Sales import')}</div><p class="small">${warningCount.toLocaleString()} warnings · ${errorCount.toLocaleString()} exclusions/errors</p></div></div>${content}`,'<button class="btn" data-close>Close</button>');
  }catch(e){toast(e.message)}
}

function sampleRowsMarkup(sample){
  return sample.map(r=>`<tr><td>${esc(r.sourceRow??'')}</td><td>${esc(r.transactionDate||'')}</td><td>${esc(r.productName||'')}</td><td>${esc(r.quantity??'')}</td><td>${money(r.salesAmount||0)}</td><td>${money(r.returnsAmount||0)}</td></tr>`).join('');
}

async function loadSampleResults(wrap,id,search=''){
  const result=await api('/api/sales/imports/'+encodeURIComponent(id)+(search?`?search=${encodeURIComponent(search)}`:''));
  const rows=result.sample||[];
  const body=wrap.querySelector('[data-sample-body]');
  const count=wrap.querySelector('[data-sample-count]');
  if(body)body.innerHTML=rows.length?sampleRowsMarkup(rows):'<tr><td colspan="6"><div class="empty">No matching rows found.</div></td></tr>';
  if(count)count.textContent=search?`${rows.length} matching row(s)`: `Showing ${rows.length} row(s)`;
}

async function openImportDetails(id){
  try{
    const d=await api('/api/sales/imports/'+encodeURIComponent(id));
    const x=d.import||{};
    const issues=d.issues||[];
    const sample=d.sample||[];
    const warnings=issues.filter(i=>i.severity==='warning');
    const excluded=issues.filter(i=>i.severity==='error');
    const issueRows=issues.map(i=>`<div class="issue-row"><div><span class="pill ${i.severity==='error'?'error':'warn'}">${esc(i.severity)}</span><strong>${esc(i.code||'Validation issue')}</strong></div><div class="small">Source row: ${esc(i.sourceRow??'—')} · ${esc(i.field||'General')}</div><p>${esc(i.message||'')}</p></div>`).join('');
    const body=`
      <div class="import-detail-head"><div><div class="eyebrow">${esc(x.business_name||x.businessName||'Business')}</div><h3>${esc(x.file_name||x.fileName||'Sales import')}</h3><p class="small">${esc(x.period_start||x.periodStart||'')} → ${esc(x.period_end||x.periodEnd||'')}</p></div><span class="pill ${String(x.status||'').includes('warning')?'warn':'success'}">${esc(x.status||'recorded')}</span></div>
      <div class="import-card-grid">
        <div class="import-stat-card"><span>Source rows</span><strong>${Number(x.row_count||x.rowCount||0).toLocaleString()}</strong></div>
        <div class="import-stat-card"><span>Valid rows</span><strong>${Number(x.valid_rows||x.validRows||0).toLocaleString()}</strong></div>
        <button class="import-stat-card warning stat-action" data-open-issues="${esc(id)}" title="View warning details"><span>Warnings</span><strong>${warnings.length||Number(x.warning_count||x.warningCount||0)}</strong><small>Click to view</small></button>
        <button class="import-stat-card danger stat-action" data-open-issues="${esc(id)}" title="View exclusions and errors"><span>Excluded / errors</span><strong>${excluded.length||Number(x.error_count||x.errorCount||0)}</strong><small>Click to view</small></button>
      </div>
      <div class="import-card-grid financial-cards">
        <div class="import-stat-card"><span>Sales</span><strong>${money(x.sales_total||x.salesTotal||0)}</strong></div>
        <div class="import-stat-card"><span>Gross</span><strong>${money(x.gross_total||x.grossTotal||0)}</strong></div>
        <div class="import-stat-card"><span>Returns</span><strong>${money(x.returns_total||x.returnsTotal||0)}</strong></div>
        <div class="import-stat-card"><span>Profit</span><strong>${money(x.profit_total||x.profitTotal||0)}</strong></div>
      </div>
      <section class="import-detail-section"><div class="panel-head"><h3>Warnings and exclusions</h3><span class="small">${issues.length} record(s)</span></div>${issues.length?`<div class="issue-list">${issueRows}</div>`:'<div class="empty">No warnings or excluded rows were recorded for this import. If the summary shows warnings but this section is empty, the original row-level details were not saved.</div>'}</section>
      <section class="import-detail-section"><div class="panel-head"><h3>Imported rows</h3><span class="small" data-sample-count>Showing ${sample.length} row(s)</span></div><form class="sample-search" data-sample-search><input class="input" name="search" placeholder="Search product, date, or transaction ID"><button class="btn" type="submit">Search</button><button class="btn ghost" type="button" data-clear-search>Clear</button></form><div class="table-wrap"><table><thead><tr><th>Source row</th><th>Date</th><th>Product</th><th>Quantity</th><th>Sales</th><th>Returns</th></tr></thead><tbody data-sample-body>${sample.length?sampleRowsMarkup(sample):'<tr><td colspan="6"><div class="empty">No sample rows available.</div></td></tr>'}</tbody></table></div><p class="small">Search can return up to 100 matching rows. Without a search, the first 100 rows are available.</p></section>`;
    const wrap=modal('Import details',body,'<button class="btn" data-close>Close</button>');
    const form=wrap.querySelector('[data-sample-search]');
    form?.addEventListener('submit',async event=>{event.preventDefault();const search=new FormData(form).get('search')?.toString().trim()||'';try{await loadSampleResults(wrap,id,search)}catch(e){toast(e.message)}});
    wrap.querySelector('[data-clear-search]')?.addEventListener('click',async()=>{form.reset();try{await loadSampleResults(wrap,id)}catch(e){toast(e.message)}});
    wrap.querySelectorAll('[data-open-issues]').forEach(button=>button.addEventListener('click',()=>openWarnings(button.dataset.openIssues)));
  }catch(e){toast(e.message)}
}

async function deleteImport(id){if(!canManageAdmin())return toast('You do not have permission to delete imports.');if(!confirm('Delete this import and its recorded sales lines? This cannot be undone.'))return;try{await api('/api/sales/imports/'+encodeURIComponent(id),{method:'DELETE'});toast('Import deleted.');await loadWorkspace();const d=await api('/api/sales/imports');state.imports=d.imports||[];document.querySelector('[data-page=history]')?.click();}catch(e){toast(e.message)}}

export function historyPage(){return pageShell('Import History',`<div class="page-intro"><div><div class="eyebrow">Data lineage</div><h2>Import history</h2><p>Every user can view the import history available to their assigned workspace.</p></div></div><div class="import-history-cards">${state.imports.length?state.imports.map(x=>`<article class="import-history-card"><div class="import-history-top"><div><div class="eyebrow">${esc(x.businessName||'Business')}</div><h3>${esc(x.fileName||'Sales import')}</h3></div><span class="pill ${x.status==='completed'?'success':'warn'}">${esc(x.status||'recorded')}</span></div><div class="import-history-meta"><div><span>Reporting period</span><strong>${esc(x.periodStart)} → ${esc(x.periodEnd)}</strong></div><div><span>Rows</span><strong>${Number(x.rowCount||0).toLocaleString()}</strong></div><div><span>Sales</span><strong>${money(x.salesTotal)}</strong></div><div><span>Warnings</span><strong>${Number(x.warningCount||0).toLocaleString()}</strong></div></div><div class="import-history-actions"><button class="btn small" data-view-import="${esc(x.id)}">View history</button>${canManageAdmin()?`<button class="btn small danger" data-delete-import="${esc(x.id)}">Delete</button>`:''}</div></article>`).join(''):`<div class="empty">${logo()}<div>No imports yet.</div><div class="small">Your completed sales imports will appear here.</div></div>`}</div>`) }
export function bindHistory(){document.querySelectorAll('[data-view-import]').forEach(b=>b.onclick=()=>openImportDetails(b.dataset.viewImport));document.querySelectorAll('[data-open-issues]').forEach(b=>b.onclick=()=>openWarnings(b.dataset.openIssues));document.querySelectorAll('[data-delete-import]').forEach(b=>b.onclick=()=>deleteImport(b.dataset.deleteImport));}
