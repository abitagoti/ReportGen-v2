const initialMonth=new Date().toISOString().slice(0,7);
const initialMonthEnd=new Date(Date.UTC(Number(initialMonth.slice(0,4)),Number(initialMonth.slice(5,7)),0)).getUTCDate();
export const state={user:null,csrf:null,permissions:{},company:null,businesses:[],imports:[],salesSummary:null,dashboardSummary:null,dashboardBusinessId:'',dashboardMonth:initialMonth,dashboardStart:`${initialMonth}-01`,dashboardEnd:`${initialMonth}-${String(initialMonthEnd).padStart(2,'0')}`,salesMode:'overview',businessDetail:null,page:'dashboard',reportingError:null,theme:localStorage.getItem('reportgen-theme')||'dark',inspection:null,mapping:null};
export const $=(s,r=document)=>r.querySelector(s);
export const $$=(s,r=document)=>[...r.querySelectorAll(s)];
export const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export const money=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:state.company?.currency||'NGN',maximumFractionDigits:2}).format(Number(n||0));
export const dateRangeLabel=(start=state.dashboardStart,end=state.dashboardEnd)=>{const format=value=>{const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:String(value||'')};return start===end?format(start):`${format(start)} – ${format(end)}`};
export const normalizedRole=role=>String(role||'').trim().toLowerCase().replace(/[-\s]+/g,'_');
export const can=permission=>{const role=normalizedRole(state.user?.role);if(['administrator','admin'].includes(role))return true;return state.permissions?.[permission]===true;};
// Roles that are neither company-wide nor the Accountant (Business Manager, Viewer) use the assigned-business workspace pages.
export const isLimitedRole=()=>{const role=normalizedRole(state.user?.role);return !['owner','general_manager','administrator','admin','accountant'].includes(role);};
// Payroll: per-employee pay needs payroll.salaries; without it the user gets the totals-only page.
export const payrollTotalsOnly=()=>!can('payroll.salaries');
// Staff: the read-only directory is used by limited roles that cannot manage staff.
export const staffReadOnlyView=()=>isLimitedRole()&&!can('staff.manage');
export const initials=s=>String(s||'RG').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
