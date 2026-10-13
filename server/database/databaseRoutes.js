const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const { requireAuth, requirePermission } = require('../auth/middleware');
const { audit } = require('../audit/auditService');
const backupService = require('./backupService');
const { logFile, logError, safeError } = require('../security/logger');

const router = express.Router();
const canManage = requirePermission('settings.manage');
fs.mkdirSync(backupService.backupDir,{recursive:true});
const uploadBackup=multer({dest:backupService.backupDir,limits:{files:1,fileSize:10*1024*1024*1024,fields:8,fieldSize:64*1024,parts:12}});

router.get('/api/database/backups', requireAuth, canManage, (req, res) => {
  res.json({ ok: true, backups: backupService.listBackups() });
});
router.get('/api/database/backups/:filename/verify', requireAuth, canManage, async (req,res)=>{
  try{
    const filename=String(req.params.filename||'');
    if(!/^reportgen-\d{4}-\d{2}-\d{2}T.*\.sqlite$/.test(filename))return res.status(400).json({ok:false,error:'Invalid backup filename.'});
    const file=require('node:path').join(backupService.backupDir,filename);
    if(require('node:path').resolve(file)!==require('node:path').resolve(backupService.backupDir,filename))return res.status(400).json({ok:false,error:'Invalid backup filename.'});
    const result=await backupService.verifyBackupFile(file);
    res.json({ok:true,filename,...result});
  }catch(error){res.status(400).json({ok:false,error:error.message||'Backup verification failed.'});}
});
router.get('/api/database/export', requireAuth, canManage, async (req, res) => {
  try {
    const result = await backupService.createVerifiedBackup({ reason: 'export' });
    res.download(result.file, result.filename);
    audit(req, { action: 'CREATE', entityType: 'database_backup', details: result });
  } catch (error) {
    logError('database.export_failed', { error: safeError(error) });
    res.status(500).json({ ok: false, error: 'Database export failed.' });
  }
});
router.post('/api/database/backup-now', requireAuth, canManage, async (req, res) => {
  try {
    const result = await backupService.createVerifiedBackup({ reason: 'manual' });
    const { file, ...publicResult } = result;
    audit(req, { action: 'CREATE', entityType: 'database_backup', details: publicResult });
    res.json(publicResult);
  } catch (error) {
    logError('database.backup_failed', { error: safeError(error) });
    res.status(500).json({ ok: false, error: 'Database backup failed.' });
  }
});
router.post('/api/database/import', requireAuth, canManage, (req,res,next)=>{req.setTimeout(30*60*1000);uploadBackup.single('file')(req,res,error=>{if(error)return res.status(413).json({ok:false,error:error.code==='LIMIT_FILE_SIZE'?'Database backup exceeds the 10 GB restore limit.':error.message});next();});}, async (req, res) => {
  try {
    if(!req.file)return res.status(400).json({ok:false,error:'Choose a database backup file to restore.'});
    const result = await backupService.importDatabaseFile(req.file.path);
    audit(req, { action: 'IMPORT', entityType: 'database', details: result });
    res.json({ ...result, message: 'Database imported successfully. Restart the ReportGen server to load the imported database.' });
  } catch (error) {
    logError('database.import_failed', { error: safeError(error) });
    res.status(400).json({ ok: false, error: error.message || 'Database import failed. Current database was not changed.' });
  } finally {
    if(req.file?.path)try{fs.rmSync(req.file.path,{force:true});}catch{}
  }
});
module.exports = router;
