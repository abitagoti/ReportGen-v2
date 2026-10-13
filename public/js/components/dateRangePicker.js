import {state} from '../state.js';

const pad=n=>String(n).padStart(2,'0');
const toISO=date=>`${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
const fromISO=value=>{const [y,m,d]=String(value||'').split('-').map(Number);return new Date(Date.UTC(y,m-1,d));};
const parseISO=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return null;const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date:null;};
const parseDisplay=value=>{const match=String(value||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return match?parseISO(`${match[3]}-${pad(match[2])}-${pad(match[1])}`):null;};
const display=value=>{const date=parseISO(value);return date?`${pad(date.getUTCDate())}/${pad(date.getUTCMonth()+1)}/${date.getUTCFullYear()}`:'';};
const monthName=date=>date.toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
let outsideHandlerBound=false;

export function dateRangePickerMarkup(){
  const start=state.dashboardStart||`${state.dashboardMonth}-01`,end=state.dashboardEnd||start;
  const field=(endpoint,value,label)=>`<div class="date-range-endpoint"><label for="dateRange${endpoint}">${label}</label><div class="date-range-control"><input type="text" class="date-range-text" id="dateRange${endpoint}" data-range-input="${endpoint.toLowerCase()}" inputmode="numeric" autocomplete="off" placeholder="dd/mm/yyyy" aria-label="${label} date" value="${display(value)}"><button type="button" class="date-range-open" data-range-open="${endpoint.toLowerCase()}" aria-label="Choose ${label.toLowerCase()} date" aria-haspopup="dialog" aria-expanded="false">▦</button></div></div>`;
  return `<div class="date-range-picker" id="dateRangePicker"><span class="date-range-label">Date range</span><div class="date-range-inputs">${field('Start',start,'From')}<span class="date-range-to" aria-hidden="true">to</span>${field('End',end,'To')}</div><div class="custom-calendar" id="customCalendar" role="dialog" aria-label="Choose reporting date" hidden></div></div>`;
}

export function bindDateRangePicker(onChange){
  const root=document.getElementById('dateRangePicker'),popup=document.getElementById('customCalendar');
  if(!root||!popup)return;
  if(!outsideHandlerBound){document.addEventListener('click',event=>{const active=document.getElementById('dateRangePicker');if(active&&!active.contains(event.target)){const calendar=document.getElementById('customCalendar');if(calendar)calendar.hidden=true;active.querySelectorAll('[data-range-open]').forEach(button=>button.setAttribute('aria-expanded','false'));}});outsideHandlerBound=true;}
  let viewDate=fromISO(state.dashboardStart||`${state.dashboardMonth}-01`),endpoint='start';
  const close=()=>{popup.hidden=true;root.querySelectorAll('[data-range-open]').forEach(button=>button.setAttribute('aria-expanded','false'));};
  const setDisplayedDates=()=>{const start=root.querySelector('[data-range-input="start"]'),end=root.querySelector('[data-range-input="end"]');if(start){start.value=display(state.dashboardStart);start.setCustomValidity('');}if(end){end.value=display(state.dashboardEnd);end.setCustomValidity('');}};
  const applyDate=selected=>{
    let start=state.dashboardStart||`${state.dashboardMonth}-01`,end=state.dashboardEnd||start;
    if(endpoint==='start'){start=selected;if(start>end)end=start;}else{end=selected;if(end<start)start=end;}
    state.dashboardStart=start;state.dashboardEnd=end;state.dashboardMonth=start.slice(0,7);setDisplayedDates();close();onChange?.(start,end);
  };
  const commitInput=input=>{
    endpoint=input.dataset.rangeInput;
    const parsed=parseDisplay(input.value),date=parseISO(state[`dashboard${endpoint==='start'?'Start':'End'}`]);
    if(!parsed){input.setCustomValidity('Enter a real date as dd/mm/yyyy.');input.reportValidity();return;}
    const selected=toISO(parsed);input.setCustomValidity('');
    if(selected===toISO(date||fromISO(state.dashboardStart||`${state.dashboardMonth}-01`))){input.value=display(selected);return;}
    applyDate(selected);
  };
  const draw=()=>{
    const year=viewDate.getUTCFullYear(),month=viewDate.getUTCMonth(),first=new Date(Date.UTC(year,month,1));
    const offset=first.getUTCDay(),start=state.dashboardStart||'',end=state.dashboardEnd||'';
    let cells='';
    for(let i=0;i<42;i++){
      const date=new Date(Date.UTC(year,month,1-offset+i)),iso=toISO(date),inMonth=date.getUTCMonth()===month;
      const selected=iso===(endpoint==='start'?start:end),between=start&&end&&iso>start&&iso<end;
      cells+=`<button type="button" class="calendar-day ${inMonth?'':'outside'} ${selected?'selected':''} ${between?'in-range':''}" data-calendar-day="${iso}" aria-pressed="${selected}" ${inMonth?'':'tabindex="-1"'}>${date.getUTCDate()}</button>`;
    }
    popup.innerHTML=`<div class="calendar-head"><button type="button" class="calendar-nav" data-calendar-shift="-1" aria-label="Previous month">‹</button><strong>${monthName(viewDate)}</strong><button type="button" class="calendar-nav" data-calendar-shift="1" aria-label="Next month">›</button></div><div class="calendar-weekdays">${['Su','Mo','Tu','We','Th','Fr','Sa'].map(x=>`<span>${x}</span>`).join('')}</div><div class="calendar-grid">${cells}</div><div class="calendar-foot"><span>Choose the ${endpoint==='start'?'start':'end'} date</span><button type="button" data-calendar-today>Today</button></div>`;
  };
  popup.addEventListener('click',event=>{
    const shift=event.target.closest('[data-calendar-shift]');
    if(shift){event.preventDefault();event.stopPropagation();viewDate=new Date(Date.UTC(viewDate.getUTCFullYear(),viewDate.getUTCMonth()+Number(shift.dataset.calendarShift),1));draw();return;}
    const day=event.target.closest('[data-calendar-day]');
    if(day){event.preventDefault();applyDate(day.dataset.calendarDay);return;}
    if(event.target.closest('[data-calendar-today]')){event.preventDefault();applyDate(toISO(new Date()));}
  });
  root.querySelectorAll('[data-range-input]').forEach(input=>{
    input.addEventListener('input',()=>input.setCustomValidity(''));
    input.addEventListener('change',()=>commitInput(input));
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitInput(input);input.blur();}});
    input.addEventListener('blur',()=>{if(input.value!==display(state[`dashboard${input.dataset.rangeInput==='start'?'Start':'End'}`]))commitInput(input);});
  });
  root.querySelectorAll('[data-range-open]').forEach(button=>button.addEventListener('click',()=>{
    const wasOpen=!popup.hidden&&endpoint===button.dataset.rangeOpen;
    endpoint=button.dataset.rangeOpen;
    if(wasOpen){close();return;}
    viewDate=fromISO(endpoint==='start'?state.dashboardStart||`${state.dashboardMonth}-01`:state.dashboardEnd||state.dashboardStart||`${state.dashboardMonth}-01`);
    popup.hidden=false;root.querySelectorAll('[data-range-open]').forEach(item=>item.setAttribute('aria-expanded',String(item===button)));draw();
  }));
}
