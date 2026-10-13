import {state,esc,can} from '../state.js';
import {api} from '../api.js';
import {pageShell,toast} from '../components/ui.js';

let messages=[];
let recipients=[];
let loaded=false;
let activeFolder='inbox';
let selectedId=null;
let messageOpen=false;
let composeOpen=false;
let composeDraft={recipientUserIds:[],businessId:'',subject:'',body:''};

const roleLabel=role=>({admin:'Administrator',administrator:'Administrator',owner:'Owner',general_manager:'General Manager',accountant:'Accountant',business_manager:'Business Manager',viewer:'Viewer'}[String(role||'').toLowerCase()]||role||'User');
const dateLabel=value=>value?new Date(value).toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'}):'—';
const shortDate=value=>value?new Date(value).toLocaleDateString('en-NG',{month:'short',day:'numeric'}):'—';
const currentUserId=()=>state.user?.id||state.user?.userId||state.user?.user_id;
const isIncoming=m=>m.recipientUserId===currentUserId();
const unreadCount=()=>messages.filter(m=>isIncoming(m)&&m.status==='unread').length;
const sentCount=()=>messages.filter(m=>!isIncoming(m)).length;

export function messagesPage(){
  return pageShell('Messages',`<div class="page-intro"><div><div class="eyebrow">Internal communication</div><h2>Messages</h2><p>Communicate with your team through a focused, mail-style workspace.</p></div><button class="btn" id="refreshMessages">Refresh</button></div><div class="mail-layout" id="mailWorkspace"></div>`);
}

function folderButton(id,label,count){
  return `<button class="mail-folder ${activeFolder===id?'active':''}" data-mail-folder="${id}"><span>${label}</span><span>${count}</span></button>`;
}

function filteredMessages(){
  if(activeFolder==='inbox')return messages.filter(isIncoming);
  if(activeFolder==='sent')return messages.filter(m=>!isIncoming(m));
  if(activeFolder==='unread')return messages.filter(m=>isIncoming(m)&&m.status==='unread');
  return messages.filter(isIncoming);
}

function renderWorkspace(){
  const root=document.getElementById('mailWorkspace');
  if(!root)return;
  const list=filteredMessages();
  if(selectedId&&!list.some(m=>m.id===selectedId)){selectedId=null;messageOpen=false;}
  const selected=messageOpen?messages.find(m=>m.id===selectedId):null;
  root.innerHTML=`<aside class="mail-sidebar"><button class="btn primary mail-compose-btn" id="openCompose">✎ Compose message</button><div class="eyebrow" style="margin:0 0 8px 8px">Mailbox</div>${folderButton('inbox','Inbox',messages.filter(isIncoming).length)}${folderButton('unread','Unread',unreadCount())}${folderButton('sent','Sent',sentCount())}<div class="small" style="margin:24px 8px 0">Messages stay inside your company workspace and are visible only to the relevant participants.</div></aside><section class="mail-list" style="grid-column:span 2"><div class="mail-list-head"><div><h3>${activeFolder==='sent'?'Sent':activeFolder==='unread'?'Unread':'Inbox'}</h3><div class="small">${list.length} message${list.length===1?'':'s'}</div></div><span class="pill success">Internal</span></div><div class="mail-list-items">${list.length?list.map(m=>mailRow(m,false)).join(''):'<div class="empty" style="margin:16px">No messages in this folder.</div>'}</div></section>${messageOpen?readerMarkup(selected):''}${composeOpen?composeMarkup():''}`;
  bindWorkspace();
}

function mailRow(m,active){
  const incoming=isIncoming(m);
  const person=incoming?(m.senderName||'User'):(m.recipientName||'User');
  return `<button class="mail-row ${active?'active':''} ${m.status==='unread'&&incoming?'unread':''}" data-mail-select="${esc(m.id)}"><span class="mail-row-sender">${esc(incoming?person:`To: ${person}`)}</span><span class="mail-row-subject">${esc(m.subject)}</span><span class="mail-row-meta"><span>${esc(m.businessName||'General company')}</span><span>${esc(shortDate(m.createdAt))}</span></span></button>`;
}

function readerMarkup(m){
  if(!m)return '';
  const incoming=isIncoming(m);
  const person=incoming?(m.senderName||'User'):(m.recipientName||'User');
  return `<div class="modal-backdrop message-reader-backdrop" id="messageReaderModal"><div class="modal modal-scroll message-reader-modal" role="dialog" aria-modal="true" aria-labelledby="messageReaderTitle"><div class="modal-head"><div><div class="eyebrow">Internal communication</div><h3 id="messageReaderTitle">${incoming?'Received message':'Sent message'}</h3><div class="small">${esc(dateLabel(m.createdAt))}</div></div><button class="close" type="button" id="closeMessageReader" aria-label="Close">×</button></div><div class="modal-content mail-reader-body"><span class="pill ${m.status==='unread'?'warn':'success'}">${esc(m.status||'read')}</span><h2 class="mail-reader-subject">${esc(m.subject)}</h2><div class="mail-person"><span class="avatar">${esc((person||'U').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase())}</span><div><strong>${esc(person)}</strong><div class="small">${incoming?'Sender':'Recipient'} · ${esc(m.businessName||'General company')}</div></div></div><div class="mail-body">${esc(m.body)}</div><div class="actions" style="margin-top:24px">${incoming&&m.status==='unread'?'<button class="btn" id="markSelectedRead">Mark as read</button>':''}<button class="btn" id="replySelected">Reply</button><button class="btn danger" id="deleteForMe">Delete for me</button>${!incoming?'<button class="btn danger" id="deleteForEveryone">Delete for everyone</button>':''}</div></div></div></div>`;
}

function composeMarkup(){
  const selectedRecipients=new Set(composeDraft.recipientUserIds||[]);
  const selectedNames=recipients.filter(u=>selectedRecipients.has(u.id)).map(u=>u.displayName||u.username);
  const recipientOptions=recipients.map(u=>`<label class="recipient-check"><input type="checkbox" data-recipient-check value="${esc(u.id)}" ${selectedRecipients.has(u.id)?'checked':''}><span>${esc(u.displayName||u.username)} <small>· ${esc(roleLabel(u.role))}</small></span></label>`).join('');
  return `<div class="modal-backdrop message-compose-backdrop" id="messageComposeModal"><div class="modal modal-scroll message-compose-modal" role="dialog" aria-modal="true" aria-labelledby="messageComposeTitle"><div class="modal-head"><div><div class="eyebrow">Internal communication</div><h3 id="messageComposeTitle">New message</h3></div><button class="close" type="button" id="closeCompose" aria-label="Close">×</button></div><div class="modal-content"><form id="messageComposeForm" class="form-stack"><div class="field"><label>Recipients</label><button type="button" class="btn secondary" id="openRecipientPicker">Choose recipients (${selectedRecipients.size})</button><div class="small" id="selectedRecipientSummary">${selectedNames.length?esc(selectedNames.join(', ')):'No recipients selected'}</div><div class="recipient-picker" id="recipientPicker" hidden><div class="recipient-picker-list">${recipientOptions||'<div class="small">No other active users found.</div>'}</div><div class="actions"><button type="button" class="btn primary" id="addRecipients">Add selected</button><button type="button" class="btn ghost" id="cancelRecipientPicker">Cancel</button></div></div></div><div class="field"><label for="messageBusiness">Related business (optional)</label><select class="input" id="messageBusiness" name="businessId"><option value="">General company message</option>${(state.businesses||[]).map(b=>`<option value="${esc(b.id)}" ${composeDraft.businessId===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div><div class="field"><label for="messageSubject">Subject</label><input class="input" id="messageSubject" name="subject" maxlength="160" required placeholder="Subject" value="${esc(composeDraft.subject||'')}"></div><div class="field"><label for="messageBody">Message</label><textarea class="input" id="messageBody" name="body" rows="9" maxlength="10000" required placeholder="Write your message…">${esc(composeDraft.body||'')}</textarea></div><div class="actions"><button class="btn primary" type="submit">Send message</button><button class="btn ghost" type="button" id="cancelCompose">Discard</button></div></form></div></div></div>`;
}

function openCompose(draft={}){
  composeDraft={recipientUserIds:[],businessId:'',subject:'',body:'',...draft};
  messageOpen=false;
  composeOpen=true;
  renderWorkspace();
}

function bindWorkspace(){
  document.querySelectorAll('[data-mail-folder]').forEach(button=>button.addEventListener('click',()=>{activeFolder=button.dataset.mailFolder;selectedId=null;messageOpen=false;composeOpen=false;renderWorkspace();}));
  document.querySelectorAll('[data-mail-select]').forEach(button=>button.addEventListener('click',async()=>{selectedId=button.dataset.mailSelect;messageOpen=true;composeOpen=false;const m=messages.find(x=>x.id===selectedId);if(m&&isIncoming(m)&&m.status==='unread'){try{await api(`/api/messages/${encodeURIComponent(m.id)}/read`,{method:'PATCH'});m.status='read';await loadMessages(false);renderWorkspace();}catch(e){toast(e.message);}}else renderWorkspace();}));
  document.getElementById('openCompose')?.addEventListener('click',()=>openCompose());
  document.getElementById('closeMessageReader')?.addEventListener('click',()=>{selectedId=null;messageOpen=false;renderWorkspace();});
  document.getElementById('messageReaderModal')?.addEventListener('click',event=>{if(event.target.id==='messageReaderModal'){selectedId=null;messageOpen=false;renderWorkspace();}});
  document.getElementById('closeCompose')?.addEventListener('click',()=>{composeOpen=false;renderWorkspace();});
  document.getElementById('messageComposeModal')?.addEventListener('click',event=>{if(event.target.id==='messageComposeModal'){composeOpen=false;renderWorkspace();}});
  document.getElementById('cancelCompose')?.addEventListener('click',()=>{composeOpen=false;renderWorkspace();});
  document.getElementById('markSelectedRead')?.addEventListener('click',async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;try{await api(`/api/messages/${encodeURIComponent(m.id)}/read`,{method:'PATCH'});await loadMessages(false);renderWorkspace();}catch(e){toast(e.message);}});
  document.getElementById('replySelected')?.addEventListener('click',()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;const recipientId=isIncoming(m)?m.senderUserId:m.recipientUserId;openCompose({recipientUserIds:recipientId?[recipientId]:[],businessId:m.businessId||'',subject:/^Re:/i.test(m.subject||'')?m.subject:`Re: ${m.subject||''}`,body:`\n\n--- Original message ---\n${m.body||''}`});});
  document.getElementById('openRecipientPicker')?.addEventListener('click',()=>{const picker=document.getElementById('recipientPicker');if(picker)picker.hidden=false;});
  document.getElementById('cancelRecipientPicker')?.addEventListener('click',()=>{const picker=document.getElementById('recipientPicker');if(picker)picker.hidden=true;});
  document.getElementById('addRecipients')?.addEventListener('click',()=>{composeDraft.recipientUserIds=Array.from(document.querySelectorAll('[data-recipient-check]:checked')).map(input=>input.value);renderWorkspace();});
  const deleteMessage=async(mode)=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;const prompt=mode==='everyone'?'Delete this message for everyone? The message will be removed for all participants.':'Delete this message for you? Other participants will still see their copy.';if(!confirm(prompt))return;try{await api(`/api/messages/${encodeURIComponent(m.id)}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});toast(mode==='everyone'?'Message deleted for everyone.':'Message deleted for you.');selectedId=null;messageOpen=false;await loadMessages(false);renderWorkspace();}catch(e){toast(e.message);}};
  document.getElementById('deleteForMe')?.addEventListener('click',()=>deleteMessage('me'));
  document.getElementById('deleteForEveryone')?.addEventListener('click',()=>deleteMessage('everyone'));
  const form=document.getElementById('messageComposeForm');
  form?.addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());data.recipientUserIds=[...(composeDraft.recipientUserIds||[])];if(!data.recipientUserIds.length){toast('Select at least one recipient.');return;}data.businessId=data.businessId||null;try{await api('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});toast(`Message sent to ${data.recipientUserIds.length} recipient${data.recipientUserIds.length===1?'':'s'}.`);composeOpen=false;composeDraft={recipientUserIds:[],businessId:'',subject:'',body:''};activeFolder='sent';await loadMessages(false);renderWorkspace();}catch(e){toast(e.message);}});
}

async function loadMessages(repaint=true){const d=await api('/api/messages');messages=d.messages||[];if(repaint)renderWorkspace();}
async function loadRecipients(){const d=await api('/api/messages/recipients');recipients=d.users||[];}

export function bindMessages(){
  if(!can('messages.send'))return;
  document.getElementById('refreshMessages')?.addEventListener('click',()=>Promise.all([loadRecipients(),loadMessages()]).catch(e=>toast(e.message)));
  if(!loaded){loaded=true;Promise.all([loadRecipients(),loadMessages()]).catch(e=>{const root=document.getElementById('mailWorkspace');if(root)root.innerHTML=`<div class="notice error">${esc(e.message||'Unable to load messages.')}</div>`;});}
}
