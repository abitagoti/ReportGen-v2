import {api} from '../api.js';
import {esc} from '../state.js';

export async function legalDocuments(){
  const d=await api('/api/legal/documents');
  return d;
}

export function legalModal(doc){
  const overlay=document.createElement('div');
  overlay.className='modal-backdrop';
  overlay.innerHTML=`<div class="modal-card legal-doc-modal" role="dialog" aria-modal="true" aria-labelledby="legalTitle"><div class="modal-head"><div><div class="eyebrow">REPORTGEN · LEGAL</div><h3 id="legalTitle">${esc(doc.title)}</h3><div class="small">Version ${esc(doc.version)} · Draft for legal review</div></div><button class="modal-close" id="closeLegal" aria-label="Close document">×</button></div><div class="legal-doc-scroll" tabindex="0"><div class="legal-doc-body">${esc(doc.body)}</div></div><div class="legal-modal-footer"><span class="small">Scroll to read the complete document.</span><button class="btn primary" id="doneLegal">Close document</button></div></div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.querySelector('#closeLegal').onclick=close;
  overlay.querySelector('#doneLegal').onclick=close;
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
}
