const express = require('express');
const { z } = require('zod');
const { db } = require('../database/database');
const { id } = require('../lib/ids');
const { nowIso } = require('../lib/time');
const { requireAuth, requirePermission } = require('../auth/middleware');
const { audit } = require('../audit/auditService');
const router = express.Router();

router.get('/api/messages/recipients', requireAuth, requirePermission('messages.send'), (req,res)=>{
  const users=db.prepare(`SELECT id,display_name AS displayName,username,role FROM users WHERE company_id=? AND is_active=1 AND id<>? ORDER BY display_name COLLATE NOCASE, username COLLATE NOCASE`).all(req.user.company_id,req.user.user_id);
  res.json({users});
});
const oversightRoles = ['owner','general_manager','administrator','admin'];
const schema = z.object({ recipientUserIds: z.array(z.string().min(1)).min(1).max(100), businessId: z.string().nullable().optional(), subject: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(10000) });
router.get('/api/messages', requireAuth, (req,res)=>{
  const rows=db.prepare(`SELECT m.id,m.business_id AS businessId,b.name AS businessName,m.sender_user_id AS senderUserId,s.display_name AS senderName,m.recipient_user_id AS recipientUserId,r.display_name AS recipientName,m.subject,m.body,m.status,m.created_at AS createdAt,m.read_at AS readAt FROM internal_messages m JOIN users s ON s.id=m.sender_user_id JOIN users r ON r.id=m.recipient_user_id LEFT JOIN businesses b ON b.id=m.business_id WHERE m.company_id=? AND (m.sender_user_id=? OR m.recipient_user_id=?) AND (m.sender_user_id!=? OR m.deleted_by_sender_at IS NULL) AND (m.recipient_user_id!=? OR m.deleted_by_recipient_at IS NULL) ORDER BY m.created_at DESC`).all(req.user.company_id,req.user.user_id,req.user.user_id,req.user.user_id,req.user.user_id);
  res.json({messages:rows});
});
router.post('/api/messages', requireAuth, requirePermission('messages.send'), (req,res)=>{
  const parsed=schema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message||'Invalid message.'});
  const v=parsed.data;
  const uniqueRecipientIds=[...new Set(v.recipientUserIds)].filter(userId=>userId!==req.user.user_id);
  if(!uniqueRecipientIds.length)return res.status(400).json({error:'Select at least one other active recipient.'});
  const recipients=uniqueRecipientIds.map(userId=>db.prepare('SELECT id,role FROM users WHERE id=? AND company_id=? AND is_active=1').get(userId,req.user.company_id));
  if(recipients.some(recipient=>!recipient))return res.status(404).json({error:'One or more recipients were not found.'});
  if(v.businessId && !db.prepare('SELECT id FROM businesses WHERE id=? AND company_id=?').get(v.businessId,req.user.company_id))return res.status(404).json({error:'Business not found.'});
  const now=nowIso();
  const insert=db.prepare('INSERT INTO internal_messages (id,company_id,business_id,sender_user_id,recipient_user_id,subject,body,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const messageIds=[];
  const transaction=db.transaction(()=>{
    for(const recipient of recipients){
      const messageId=id('msg');
      insert.run(messageId,req.user.company_id,v.businessId||null,req.user.user_id,recipient.id,v.subject,v.body,'unread',now);
      messageIds.push(messageId);
      audit(req,{action:'message.created',entityType:'internal_message',entityId:messageId,businessId:v.businessId||null,details:{recipientUserId:recipient.id,subject:v.subject}});
    }
  });
  transaction();
  res.status(201).json({messageIds,count:messageIds.length});
});
router.patch('/api/messages/:messageId/read', requireAuth, (req,res)=>{
  const now=nowIso(); const result=db.prepare("UPDATE internal_messages SET status='read',read_at=? WHERE id=? AND company_id=? AND recipient_user_id=?").run(now,req.params.messageId,req.user.company_id,req.user.user_id);
  if(!result.changes)return res.status(404).json({error:'Message not found.'}); res.json({ok:true});
});
router.delete('/api/messages/:messageId', requireAuth, (req,res)=>{
  const mode=String(req.body?.mode||'me').toLowerCase();
  const message=db.prepare('SELECT id,sender_user_id AS senderUserId,recipient_user_id AS recipientUserId FROM internal_messages WHERE id=? AND company_id=?').get(req.params.messageId,req.user.company_id);
  if(!message || ![message.senderUserId,message.recipientUserId].includes(req.user.user_id))return res.status(404).json({error:'Message not found or you do not have permission to delete it.'});
  if(mode==='everyone'){
    if(message.senderUserId!==req.user.user_id)return res.status(403).json({error:'Only the sender can delete a message for everyone.'});
    const result=db.prepare('DELETE FROM internal_messages WHERE id=? AND company_id=? AND sender_user_id=?').run(req.params.messageId,req.user.company_id,req.user.user_id);
    if(!result.changes)return res.status(404).json({error:'Message not found.'});
    audit(req,{action:'message.deleted_for_everyone',entityType:'internal_message',entityId:req.params.messageId,details:{mode:'everyone'}});
    return res.json({ok:true,mode:'everyone'});
  }
  if(mode!=='me')return res.status(400).json({error:'Delete mode must be me or everyone.'});
  const column=message.senderUserId===req.user.user_id?'deleted_by_sender_at':'deleted_by_recipient_at';
  const result=db.prepare(`UPDATE internal_messages SET ${column}=? WHERE id=? AND company_id=?`).run(nowIso(),req.params.messageId,req.user.company_id);
  if(!result.changes)return res.status(404).json({error:'Message not found.'});
  audit(req,{action:'message.deleted_for_me',entityType:'internal_message',entityId:req.params.messageId,details:{mode:'me'}});
  res.json({ok:true,mode:'me'});
});

module.exports=router;
