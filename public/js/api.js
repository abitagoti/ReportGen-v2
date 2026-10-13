import {normalizedRole,state} from './state.js';
import {beginLoading,endLoading,loadingLabel} from './components/ui.js';

export function newIdempotencyKey(prefix='req'){
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}`;
}

export function submissionKey(form,prefix='submit'){
  if(!form) return newIdempotencyKey(prefix);
  if(!form.dataset.reportgenIdempotencyKey) form.dataset.reportgenIdempotencyKey=newIdempotencyKey(prefix);
  return form.dataset.reportgenIdempotencyKey;
}

export async function api(url,opts={}){
  const o={...opts,headers:{...(opts.headers||{})}};
  const method=(o.method||'GET').toUpperCase();
  const silent=!!o.silent;
  const message=o.loadingMessage||loadingLabel(url,method);
  delete o.loadingMessage;
  delete o.silent;
  if(state.csrf&&!['GET','HEAD'].includes(method))o.headers['x-csrf-token']=state.csrf;
  if(opts.idempotencyKey && !['GET','HEAD'].includes(method)) {
    o.headers['Idempotency-Key']=String(opts.idempotencyKey);
    delete o.idempotencyKey;
  }
  const showLoading=!silent || window.__reportgenRuntimeLoading===true;
  if(showLoading)beginLoading(message);
  try{
    let r;
    let lastError;
    for(let attempt=0;attempt<2;attempt++){
      try{
        r=await fetch(url,o);
        lastError=null;
        break;
      }catch(error){
        lastError=error;
        const message=String(error?.message||'');
        const retryable=/network changed|failed to fetch|network error/i.test(message);
        if(!retryable || attempt===1)throw error;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
    }
    if(lastError)throw lastError;
    let d={};
    try{d=await r.json()}catch{}
    if(!r.ok){const error=new Error(d.error||`Request failed (${r.status})`);error.status=r.status;throw error;}
    return d;
  }finally{
    if(showLoading)endLoading();
  }
}

export async function loadPublicBranding(){
  const d=await api('/api/public/branding');
  state.company={...(state.company||{}),name:d.name||'ReportGen',logoDataUrl:d.logoDataUrl||null};
  return d;
}

export async function loadSalesSummary(month=state.dashboardMonth,opts={}){
  const requestId=++salesSummaryRequest;
  const params=new URLSearchParams({month});
  if(opts.start&&opts.end){params.set('start',opts.start);params.set('end',opts.end);}
  const d=await api('/api/sales/summary?'+params.toString(),opts.silent?{silent:true}:{});
  if(requestId!==salesSummaryRequest)return d;
  state.dashboardMonth=d.month||month;
  if(d.start)state.dashboardStart=d.start;
  if(d.end)state.dashboardEnd=d.end;
  state.salesSummary=d;
  return d;
}

export async function loadBusinesses(month=state.dashboardMonth,opts={}){
  const start=opts.start||state.dashboardStart||`${month}-01`;
  const end=opts.end||state.dashboardEnd||`${month}-${String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0')}`;
  const params=new URLSearchParams({month,start,end});
  const d=await api('/api/businesses?'+params.toString(),opts.silent?{silent:true}:{});
  state.businesses=Array.isArray(d.businesses)?d.businesses:[];
  return d;
}

export async function loadWorkspace(){
  const role=encodeURIComponent(state.user?.role||'viewer');
  const p=await api('/api/permissions/'+role);
  state.permissions=Object.fromEntries((p.permissions||[]).map(x=>[x.key,!!x.enabled]));
  const month=state.dashboardMonth;
  const start=state.dashboardStart||`${month}-01`;
  const end=state.dashboardEnd||`${month}-${String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0')}`;
  const [c,b]=await Promise.all([
    api('/api/company'),
    loadBusinesses(month,{start,end,silent:true})
  ]);
  state.company=c.company;
  state.businesses=b.businesses||[];
  state.imports=[];
  state.salesSummary=null;
  state.dashboardSummary=null;
  state.expenseSummary=null;
  state.dashboardBusinessId='';
}

export async function loadWorkspaceExtras(){
  const month=state.dashboardMonth;
  const start=state.dashboardStart;
  const end=state.dashboardEnd;
  const isOwner=['owner','general_manager','administrator','admin'].includes(normalizedRole(state.user?.role));
  const tasks=[];
  if(isOwner)tasks.push(api(`/api/owner/expense-summary?month=${encodeURIComponent(month)}&start=${encodeURIComponent(state.dashboardStart)}&end=${encodeURIComponent(state.dashboardEnd)}`,{silent:true}).then(d=>{state.expenseSummary=d}).catch(()=>{state.expenseSummary=null}));
  if(state.permissions['dashboard.view']===true)tasks.push(loadDashboardSummary(month,{start,end,businessId:state.dashboardBusinessId||'',silent:true}));
  if(state.permissions['sales.view']===true)tasks.push(loadSalesSummary(month,{start,end,silent:true}));
  if(state.permissions['history.view']===true)tasks.push(api('/api/sales/imports',{silent:true}).then(d=>{state.imports=d.imports||[]}).catch(()=>{state.imports=[]}));
  try {
    await Promise.all(tasks);
    state.reportingError=null;
  } catch (error) {
    state.reportingError=error.message||'Unable to load reporting data.';
    throw error;
  }
}

let dashboardSummaryRequest=0;
let salesSummaryRequest=0;

export async function loadDashboardSummary(month=state.dashboardMonth,opts={}){
  const requestId=++dashboardSummaryRequest;
  const params=new URLSearchParams({month});
  if(opts.start&&opts.end){params.set('start',opts.start);params.set('end',opts.end);}
  if(opts.businessId)params.set('businessId',opts.businessId);
  const d=await api('/api/dashboard/summary?'+params.toString(),opts.silent?{silent:true}:{});
  if(requestId!==dashboardSummaryRequest) return state.dashboardSummary||d;
  state.dashboardSummary=d;
  return d;
}
