const { createVerifiedBackup, listBackups } = require('./backupService');

let timer = null;
let running = false;


function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function runMonthlyBackupIfNeeded() {
  if (running) return;
  const key = monthKey();
  const exists = listBackups().some((backup) => {
    const created = new Date(backup.createdAt);
    return `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}` === key;
  });
  if (exists) return;

  running = true;
  try {
    const result = await createVerifiedBackup({ reason: 'monthly-automatic' });
    info('backup.monthly_created', { filename: result.filename });
  } catch (error) {
    logError('backup.monthly_failed', { error: safeError(error) });
  } finally {
    running = false;
  }
}

function startMonthlyBackupScheduler() {
  if (timer) return;
  // Check immediately so a server started on the last day is covered.
  void runMonthlyBackupIfNeeded();
  // Hourly checks avoid requiring the server to remain alive at one exact minute.
  timer = setInterval(() => void runMonthlyBackupIfNeeded(), 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

function stopMonthlyBackupScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startMonthlyBackupScheduler, stopMonthlyBackupScheduler };
