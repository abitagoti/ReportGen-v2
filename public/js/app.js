import {state,$,$$,esc,can,normalizedRole,isLimitedRole,payrollTotalsOnly,staffReadOnlyView} from './state.js';
import {api,loadWorkspace,loadWorkspaceExtras,loadBusinesses,loadSalesSummary,loadDashboardSummary} from './api.js';
import {startup} from './pages/startup.js';
import {login,setup,applyTheme} from './pages/auth.js';
import {dashboard,bindDashboard} from './pages/dashboard.js';
import {businesses,bindBusinesses} from './pages/businesses.js';
import {sales,bindSource} from './pages/import.js';
import {historyPage,bindHistory} from './pages/history.js';
import {accountantDashboard,bindAccountantDashboard,accountantBusinesses,bindAccountant,accountantBusinessPage,bindAccountantBusiness,accountantExpensesPage,bindAccountantExpenses,accountantReportingPage,bindAccountantReporting,accountantPayrollPage,bindAccountantPayroll} from './pages/accountant.js';
import {settings} from './pages/settings.js';
import {users,bindUsers} from './pages/users.js';
import {pageShell,logo,isAccountant,toast,runWithLoading} from './components/ui.js';
import {payrollPage,bindPayrollPage,staffPage,bindStaffPage,payrollDetailPage,bindPayrollDetailPage,staffDetailPage,bindStaffDetailPage,deductionsPage,bindDeductionsPage} from './pages/payroll.js';
import {capitalPage,bindCapital,loadCapital} from './pages/capital.js';
import {ownerExpensesPage,bindOwnerExpenses} from './pages/ownerExpenses.js';
import {syncAccountantMonth} from './pages/accountant.js';
import {analysisPage,bindAnalysis} from './pages/analysis.js';
import {reportsPage,bindReports} from './pages/reports.js';
import {managerReportsPage,bindManagerReports,managerStaffPage,bindManagerStaff,managerExpensesPage,bindManagerExpenses,managerPayrollPage,bindManagerPayroll} from './pages/manager.js';
import {messagesPage,bindMessages} from './pages/messages.js';
import {auditPage,bindAudit} from './pages/audit.js';
import {vendorPaymentsPage,bindVendorPayments} from './pages/vendorPayments.js';
import {openAccountSecurity} from './pages/account.js';

const app=$('#app');
const foundationPages={purchases:'Purchases',payroll:'Payroll',analytics:'Analytics',comparison:'Company Comparison'};

async function boot(){
  applyTheme();
  const ready=await startup(app);
  if(!ready){app.innerHTML=`<div class="screen" style="display:grid;place-items:center"><div style="text-align:center">${logo(null,'')}<h2 style="font-family:Montserrat">Server unavailable</h2><p class="small">Start the ReportGen server and retry.</p><button class="btn primary" id="retry">Retry connection</button></div></div>`;$('#retry').onclick=boot;return}
  try{
    const setupState=await api('/api/setup/status');
    if(!setupState.setupComplete){state.user=null;state.csrf=null;return setup(app)}
    try{
      const d=await api('/api/auth/me');
      state.user=d.user;state.csrf=d.csrfToken;
      try{
        await loadWorkspace();
      }catch(error){
        app.innerHTML=`<div class="screen" style="display:grid;place-items:center"><div style="text-align:center;max-width:520px"><h2 style="font-family:Montserrat">Workspace loading failed</h2><p class="small">${esc(error.message||'Unable to load your workspace.')}</p><button class="btn primary" id="retry">Retry</button><button class="btn ghost" id="switchAccount">Sign in as another user</button></div></div>`;$('#retry').onclick=boot;$('#switchAccount').onclick=async()=>{state.user=null;state.csrf=null;await login(app)};return;
      }
      render();
      // Load non-critical workspace data after the first paint. Dashboard data is loaded on demand by the dashboard page.
      setTimeout(()=>{void loadWorkspaceExtras().then(()=>{if(['dashboard','businesses'].includes(state.page))render()}).catch(()=>{});},0);
    }catch(error){
      state.user=null;state.csrf=null;
      // A 401 from /api/auth/me is the normal first-load state for a signed-out user.
      // Do not show the backend authentication message on the login screen.
      await login(app,error?.status===401?'':error.message);
    }
  }catch(e){
    app.innerHTML=`<div class="screen" style="display:grid;place-items:center"><div style="text-align:center">${logo(null,'')}<h2 style="font-family:Montserrat">Workspace check failed</h2><p class="small">${esc(e.message||'Unable to determine workspace status.')}</p><button class="btn primary" id="retry">Retry connection</button></div></div>`;$('#retry').onclick=boot;
  }
}

function render(){
  const pagePermission={dashboard:'dashboard.view',businesses:'businesses.view','vendor-payments':'vendor_payments.view',sales:'sales.view',history:'history.view',expenses:'expenses.view',purchases:'capital.view',analytics:'comparison.view',comparison:'comparison.view',reports:'reports.view',payroll:'payroll.view',deductions:'payroll.deductions',staff:'staff.view',users:'users.manage',settings:'settings.manage',messages:'messages.send',audit:'audit.view'};
  if(pagePermission[state.page] && !can(pagePermission[state.page])) state.page='dashboard';
  applyTheme();
  let html='';
  if(state.page==='dashboard')html=isAccountant()?accountantDashboard():dashboard();
  else if(state.page==='businesses')html=isAccountant()?accountantBusinesses():businesses();
  else if(state.page==='sales')html=sales();
  else if(state.page==='history')html=historyPage();
  else if(state.page==='accountant-business' && isAccountant())html=accountantBusinessPage();
  else if(state.page==='expenses' && isAccountant())html=accountantExpensesPage();
  else if(state.page==='expenses' && isLimitedRole())html=managerExpensesPage();
  else if(state.page==='expenses')html=ownerExpensesPage();
  else if(state.page==='accountant-reporting' && isAccountant())html=accountantReportingPage();
  else if(state.page==='payroll' && isAccountant())html=accountantPayrollPage();
  else if(state.page==='payroll' && (isLimitedRole()||payrollTotalsOnly()))html=managerPayrollPage();
  else if(state.page==='payroll')html=payrollPage();
  else if(state.page==='deductions')html=deductionsPage();
  else if(state.page==='staff' && staffReadOnlyView())html=managerStaffPage();
  else if(state.page==='staff')html=staffPage();
  else if(state.page==='payroll-detail')html=payrollDetailPage();
  else if(state.page==='staff-detail')html=staffDetailPage();
  else if(state.page==='purchases')html=capitalPage();
  else if(state.page==='vendor-payments')html=vendorPaymentsPage();
  else if(state.page==='settings')html=settings();
  else if(state.page==='messages')html=messagesPage();
  else if(state.page==='users')html=users();
  else if(state.page==='audit')html=auditPage();
  else if(state.page==='analytics' || state.page==='comparison')html=analysisPage();
  else if(state.page==='reports')html=normalizedRole(state.user?.role)==='accountant'?accountantReportingPage():isLimitedRole()?managerReportsPage():reportsPage();
  else if(foundationPages[state.page])html=foundationPage(foundationPages[state.page],state.page);
  else html=dashboard();
  app.innerHTML=html;
  bindGlobal();
  if(state.page==='dashboard' && isAccountant())bindAccountantDashboard();
  if(state.page==='dashboard' && !isAccountant())bindDashboard();
  if(state.page==='businesses' && isAccountant())bindAccountant();
  else if(state.page==='businesses')bindBusinesses();
  if(state.page==='sales')bindSource();
  if(state.page==='users')bindUsers();
  if(state.page==='audit')void bindAudit();
  if(state.page==='messages')bindMessages();
  if(state.page==='history')bindHistory();
  if(state.page==='accountant-business' && isAccountant())bindAccountantBusiness();
  if(state.page==='expenses' && isAccountant())bindAccountantExpenses();
  if(state.page==='expenses' && isLimitedRole())bindManagerExpenses();
  else if(state.page==='expenses' && !isAccountant())bindOwnerExpenses();
  if(state.page==='accountant-reporting' && isAccountant())bindAccountantReporting();
  if(state.page==='payroll' && isAccountant())bindAccountantPayroll();
  else if(state.page==='payroll' && (isLimitedRole()||payrollTotalsOnly()))bindManagerPayroll();
  else if(state.page==='payroll')bindPayrollPage();
  if(state.page==='deductions')bindDeductionsPage();
  if(state.page==='staff' && staffReadOnlyView())bindManagerStaff();
  else if(state.page==='staff')bindStaffPage();
  if(state.page==='payroll-detail')bindPayrollDetailPage();
  if(state.page==='staff-detail')bindStaffDetailPage();
  if(state.page==='purchases')bindCapital();
  if(state.page==='vendor-payments')bindVendorPayments();
  if(state.page==='analytics' || state.page==='comparison')bindAnalysis();
  if(state.page==='reports'){if(normalizedRole(state.user?.role)==='accountant')bindAccountantReporting();else if(isLimitedRole())bindManagerReports();else bindReports();}
}

function foundationPage(title,key){
  const descriptions={expenses:'Accountant-controlled operating expenses, reusable categories, review and revision history.',purchases:'Monthly capital deployed into the company and individual businesses, with capital-efficiency analysis.',payroll:'Business-level payroll totals by reporting period without exposing employee registers to business users.',reports:'Styled executive, monthly, sales-performance, comparison and management report templates.',comparison:'Compare businesses across revenue, profit, margin, customer flow and capital efficiency.'};
  return pageShell(title, `<div class="foundation-page"><div class="foundation-mark">${key==='analytics'?'◒':'◈'}</div><div class="eyebrow">REPORTGEN · FOUNDATION</div><h2>${esc(title)}</h2><p>${esc(descriptions[key])}</p><div class="foundation-status"><span class="pill warn">Next build phase</span><span>Navigation is reserved now so the final workspace structure stays stable while the module engine is built.</span></div></div>`);
}

function bindGlobal(){
  $$('[data-page]').forEach(b=>b.onclick=async()=>{
    const nextPage=b.dataset.page;
    if(!nextPage || nextPage===state.page)return;
    await runWithLoading(`Opening ${String(b.textContent||nextPage).trim()}…`,async()=>{
      state.page=nextPage;
      render();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    },240);
  });
  const monthInput=document.getElementById('globalMonth');
  monthInput?.addEventListener('change',async()=>{
    const month=String(monthInput.value||'');
    if(!/^\d{4}-\d{2}$/.test(month))return;
    const [year,monthNumber]=month.split('-').map(Number);
    const lastDay=new Date(Date.UTC(year,monthNumber,0)).getUTCDate();
    state.dashboardMonth=month;
    state.dashboardStart=`${month}-01`;
    state.dashboardEnd=`${month}-${String(lastDay).padStart(2,'0')}`;
    state.reportingError=null;
    syncAccountantMonth(month,state.dashboardStart,state.dashboardEnd);

    // Reload every month-sensitive dataset before repainting. The dashboard
    // picker already does this itself; the global picker must keep Sales and
    // the other month-driven workspace data in sync as well.
    await runWithLoading(`Loading ${month}…`,async()=>{
      try{
        const tasks=[];
        if(state.permissions['sales.view']===true)tasks.push(loadSalesSummary(month,{start:state.dashboardStart,end:state.dashboardEnd}));
        if(state.permissions['dashboard.view']===true && !isAccountant())tasks.push(loadDashboardSummary(month,{start:state.dashboardStart,end:state.dashboardEnd,businessId:state.dashboardBusinessId||''}));
        if(['owner','general_manager','administrator','admin'].includes(String(state.user?.role||'').toLowerCase())){
          tasks.push(api(`/api/owner/expense-summary?month=${encodeURIComponent(month)}&start=${encodeURIComponent(state.dashboardStart)}&end=${encodeURIComponent(state.dashboardEnd)}`).then(d=>{state.expenseSummary=d;}));
        }
        await Promise.all(tasks);
      }catch(error){
        state.reportingError=error.message||'Unable to load the selected reporting month.';
        toast(state.reportingError);
      }
      render();
    },180);
  });
  document.querySelector('.user-chip')?.addEventListener('click',()=>openAccountSecurity());
  document.querySelector('.user-chip')?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openAccountSecurity();}});
  $('#logout')?.addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'})}finally{state.user=null;state.csrf=null;location.reload()}});
  $('#themeToggle')?.addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem('reportgen-theme',state.theme);render()});
  const sidebar=document.getElementById('appSidebar');
  const backdrop=document.getElementById('navBackdrop');
  const toggle=document.getElementById('mobileNavToggle');
  const closeNav=()=>{sidebar?.classList.remove('mobile-open');backdrop?.classList.remove('visible');toggle?.setAttribute('aria-expanded','false');};
  toggle?.addEventListener('click',()=>{const open=!sidebar?.classList.contains('mobile-open');sidebar?.classList.toggle('mobile-open',open);backdrop?.classList.toggle('visible',open);toggle?.setAttribute('aria-expanded',String(open));});
  backdrop?.addEventListener('click',closeNav);
  $$('[data-page]').forEach(b=>b.addEventListener('click',closeNav));
}

window.ReportGen={state,render};
boot();
