const pad=n=>String(n).padStart(2,'0');
const isoDate=date=>`${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
const parseISO=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return null;const [y,m,d]=value.split('-').map(Number);const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date:null};
const parseDisplay=value=>{const match=String(value||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!match)return null;return parseISO(`${match[3]}-${pad(match[2])}-${pad(match[1])}`)};
const show=value=>{const date=parseISO(value);return date?`${pad(date.getUTCDate())}/${pad(date.getUTCMonth()+1)}/${date.getUTCFullYear()}`:''};
const monthTitle=date=>date.toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});

export function dateFieldMarkup({label,name,value='',required=false,min='',max='',id=''}){
  const inputId=id?` id="${id}"`:'';
  return `<label class="field"><span>${label}${required?' *':''}</span><div class="custom-date-control"><input${inputId} class="input custom-date-text" type="text" inputmode="numeric" placeholder="dd/mm/yyyy" autocomplete="off" value="${show(value)}" data-date-text data-date-required="${required?'true':'false'}" aria-label="${label}" ${required?'required':''}><input type="hidden" name="${name}" value="${value}" data-date-iso data-date-min="${min}" data-date-max="${max}"><button type="button" class="custom-date-open" aria-label="Choose ${label}">▦</button><div class="custom-date-popup" role="dialog" aria-label="Choose ${label}" hidden></div></div></label>`;
}

export function bindCustomDateFields(root=document){
  if(!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.custom-date-control').forEach(control=>{
    if(control.dataset.dateBound)return;control.dataset.dateBound='true';
    const text=control.querySelector('[data-date-text]'),hidden=control.querySelector('[data-date-iso]'),popup=control.querySelector('.custom-date-popup'),button=control.querySelector('.custom-date-open');
    const draw=initial=>{
      const date=initial||parseISO(hidden.value)||new Date(),year=date.getUTCFullYear(),month=date.getUTCMonth(),first=new Date(Date.UTC(year,month,1)),offset=first.getUTCDay();let cells='';
      for(let i=0;i<42;i++){
        const cell=new Date(Date.UTC(year,month,1-offset+i)),iso=isoDate(cell),inside=cell.getUTCMonth()===month,selected=iso===hidden.value,min=hidden.dataset.dateMin||'',max=hidden.dataset.dateMax||'',disabled=!!((min&&iso<min)||(max&&iso>max));
        cells+=`<button type="button" class="calendar-day ${inside?'':'outside'} ${selected?'selected':''}" data-date-select="${iso}" ${disabled?'disabled':''}>${cell.getUTCDate()}</button>`;
      }
      popup.innerHTML=`<div class="calendar-head"><button type="button" class="calendar-nav" data-date-shift="-1" aria-label="Previous month">‹</button><strong>${monthTitle(date)}</strong><button type="button" class="calendar-nav" data-date-shift="1" aria-label="Next month">›</button></div><div class="calendar-weekdays">${['Su','Mo','Tu','We','Th','Fr','Sa'].map(x=>`<span>${x}</span>`).join('')}</div><div class="calendar-grid">${cells}</div><div class="calendar-foot"><span>Choose one date</span>${text.dataset.dateRequired==='true'?'':`<button type="button" data-date-clear>Clear</button>`}<button type="button" data-date-today>Today</button></div>`;
      popup.querySelectorAll('[data-date-shift]').forEach(nav=>nav.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();draw(new Date(Date.UTC(year,month+Number(nav.dataset.dateShift),1)))}));
      popup.querySelectorAll('[data-date-select]').forEach(day=>day.addEventListener('click',()=>set(day.dataset.dateSelect)));
      popup.querySelector('[data-date-today]')?.addEventListener('click',()=>set(isoDate(new Date())));
      popup.querySelector('[data-date-clear]')?.addEventListener('click',()=>set(''));
    };
    const set=value=>{hidden.value=value;text.value=show(value);text.setCustomValidity('');popup.hidden=true;button.setAttribute('aria-expanded','false');hidden.dispatchEvent(new Event('change',{bubbles:true}))};
    text.addEventListener('input',()=>{const raw=text.value.trim(),date=parseDisplay(raw),min=hidden.dataset.dateMin||'',max=hidden.dataset.dateMax||'';if(!raw&&!text.required){hidden.value='';text.setCustomValidity('');return}if(!date){hidden.value='';text.setCustomValidity('Enter a valid date as dd/mm/yyyy.');return}const value=isoDate(date);if((min&&value<min)||(max&&value>max)){hidden.value='';text.setCustomValidity('Choose a date within the allowed period.');return}hidden.value=value;text.setCustomValidity('')});
    text.addEventListener('blur',()=>{if(text.value.trim()&&parseDisplay(text.value))text.value=show(hidden.value)});
    button.addEventListener('click',()=>{popup.hidden=!popup.hidden;button.setAttribute('aria-expanded',String(!popup.hidden));if(!popup.hidden)draw()});
    document.addEventListener('click',event=>{if(!control.contains(event.target)){popup.hidden=true;button.setAttribute('aria-expanded','false')}});
  });
}
