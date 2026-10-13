const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const config = require('../config');
const { db } = require('./database');
const { nowIso } = require('../lib/time');

const backupDir = path.join(config.dataDir, 'backups');
const REQUIRED_TABLES = ['companies','users','businesses','sessions','audit_logs','sales_transactions'];
const REQUIRED_TRIGGERS = ['trg_audit_logs_no_update','trg_audit_logs_no_delete'];
const MAX_BACKUPS = Math.max(4, Number(process.env.REPORTGEN_MAX_BACKUPS || 12));

function ensureBackupDir() {
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
function integrityCheck(connection) {
  const row = connection.prepare('PRAGMA integrity_check').get();
  if (!row || String(Object.values(row)[0]) !== 'ok') throw new Error('Database integrity check failed.');
}
function validateDatabaseFile(file) {
  const candidate = new Database(file, { readonly: true, fileMustExist: true });
  try {
    integrityCheck(candidate);
    const tables = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
    const missing = REQUIRED_TABLES.filter(name => !tables.has(name));
    if (missing.length) throw new Error(`Invalid ReportGen database. Missing tables: ${missing.join(', ')}`);
    const triggers = new Set(candidate.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(x => x.name));
    const missingTriggers = REQUIRED_TRIGGERS.filter(name => !triggers.has(name));
    if (missingTriggers.length) throw new Error(`Invalid ReportGen database. Missing audit protection triggers: ${missingTriggers.join(', ')}`);
  } finally { candidate.close(); }
}

function pruneBackups() {
  const backups = listBackups();
  for (const backup of backups.slice(MAX_BACKUPS)) {
    const file = path.join(backupDir, backup.filename);
    try { fs.rmSync(file, { force: true }); } catch {}
    try { fs.rmSync(`${file}.sha256`, { force: true }); } catch {}
    try { fs.rmSync(`${file}.manifest.json`, { force: true }); } catch {}
  }
}

async function createVerifiedBackup({ reason = 'manual' } = {}) {
  ensureBackupDir();
  const filename = `reportgen-${stamp()}.sqlite`;
  const target = path.join(backupDir, filename);
  const temp = `${target}.tmp`;
  await db.backup(temp);
  validateDatabaseFile(temp);
  fs.renameSync(temp, target);
  const checksum = await hashFile(target);
  const createdAt = nowIso();
  fs.writeFileSync(`${target}.sha256`, `${checksum}  ${filename}\n`, 'utf8');
  fs.writeFileSync(`${target}.manifest.json`, JSON.stringify({format:1,filename,checksum,size:fs.statSync(target).size,createdAt,reason,integrity:'ok',requiredTables:REQUIRED_TABLES,requiredTriggers:REQUIRED_TRIGGERS},null,2)+'\n','utf8');
  pruneBackups();
  return { ok: true, filename, file: target, checksum, size: fs.statSync(target).size, createdAt, reason };
}
function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(backupDir, { withFileTypes: true })
    .filter(x => x.isFile() && /^reportgen-\d{4}-\d{2}-\d{2}T.*\.sqlite$/.test(x.name))
    .map(x => {
      const file = path.join(backupDir, x.name);
      const stat = fs.statSync(file);
      const checksumFile = `${file}.sha256`;
      const manifestFile = `${file}.manifest.json`;
      const checksum = fs.existsSync(checksumFile) ? fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0] : null;
      let manifest=null;
      try { if(fs.existsSync(manifestFile)) manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')); } catch {}
      return { filename: x.name, size: stat.size, createdAt: stat.mtime.toISOString(), checksum, manifestValid:!!manifest && manifest.filename===x.name && manifest.checksum===checksum && Number(manifest.size)===stat.size, reason:manifest?.reason||null };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
async function verifyBackupFile(file) {
  if (typeof file !== 'string' || !fs.existsSync(file)) throw new Error('Backup file not found.');
  const stat=fs.statSync(file);
  if(!stat.isFile() || !stat.size) throw new Error('Backup file is empty or invalid.');
  validateDatabaseFile(file);
  const checksum=await hashFile(file);
  const checksumFile=`${file}.sha256`;
  if(fs.existsSync(checksumFile)){
    const expected=fs.readFileSync(checksumFile,'utf8').trim().split(/\s+/)[0];
    if(!/^[a-f0-9]{64}$/i.test(expected) || expected.toLowerCase()!==checksum.toLowerCase()) throw new Error('Backup checksum verification failed.');
  }
  return {ok:true,checksum,size:stat.size,integrity:'ok'};
}
async function importDatabaseFile(incoming) {
  if (typeof incoming !== 'string' || !fs.existsSync(incoming)) throw new Error('No database backup was supplied.');
  ensureBackupDir();
  const info = fs.statSync(incoming);
  if (!info.isFile() || !info.size) throw new Error('The selected database backup is empty or invalid.');
  let safety = null;
  const liveFiles = [config.dbPath, `${config.dbPath}-wal`].map(file => { try { return fs.statSync(file).size; } catch { return 0; } });
  const estimatedSafetySize = liveFiles.reduce((sum, size) => sum + size, 0);
  try {
    const space = fs.statfsSync(path.dirname(config.dbPath));
    const freeBytes = Number(space.bavail) * Number(space.bsize);
    const requiredBytes = estimatedSafetySize + info.size + Math.max(256 * 1024 * 1024, Math.ceil(info.size * 0.1));
    if (freeBytes < requiredBytes) throw new Error(`There is not enough free disk space to restore this database safely. Free ${Math.floor(freeBytes / 1024 / 1024)} MB; about ${Math.ceil(requiredBytes / 1024 / 1024)} MB is needed in addition to the uploaded file.`);
  } catch (error) {
    if (error.message?.includes('not enough free disk space')) throw error;
    if (typeof fs.statfsSync !== 'function') throw new Error('ReportGen cannot check free disk space on this system, so restore was stopped safely.');
    throw error;
  }
  const pendingPath = `${config.dbPath}.pending`;
  const pendingTemp = `${pendingPath}.${process.pid}-${Date.now()}.tmp`;
  const previousPending = `${pendingPath}.${process.pid}-${Date.now()}.previous`;
  try {
    await verifyBackupFile(incoming);
    fs.copyFileSync(incoming, pendingTemp);
    validateDatabaseFile(pendingTemp);
    safety = await createVerifiedBackup({ reason: 'before-import' });
    if (fs.existsSync(pendingPath)) fs.renameSync(pendingPath, previousPending);
    try {
      fs.renameSync(pendingTemp, pendingPath);
      if (fs.existsSync(previousPending)) fs.rmSync(previousPending, { force: true });
    } catch (error) {
      if (!fs.existsSync(pendingPath) && fs.existsSync(previousPending)) fs.renameSync(previousPending, pendingPath);
      throw error;
    }
    return { ok: true, safetyBackup: safety.filename, pendingFile: path.basename(pendingPath), restartRequired: true, size: info.size };
  } finally {
    try { fs.rmSync(pendingTemp, { force: true }); } catch {}
  }
}
module.exports = { backupDir, createVerifiedBackup, listBackups, validateDatabaseFile, verifyBackupFile, importDatabaseFile, pruneBackups, MAX_BACKUPS };
