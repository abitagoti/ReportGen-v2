const readline = require('node:readline');
const fs = require('node:fs');
// Deliberately import only config.js (not database.js): requiring database.js
// would open/migrate/back up the very database this tool is about to delete.
// Going through config.js is what keeps this in sync with the real persistent
// path forever, instead of a path re-typed by hand that can silently drift
// (see audit finding: the old reset-database.bat targeted a stale local path).
const config = require('../config');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n========================================');
  console.log('ReportGen - Reset Local Database');
  console.log('========================================\n');
  console.log('WARNING: This will permanently delete the ReportGen database and');
  console.log('ALL company, user, business, import, and audit data it holds.\n');
  console.log(`Database: ${config.dbPath}\n`);

  const confirm = (await ask('Type DELETE to continue: ')).trim();
  if (confirm.toUpperCase() !== 'DELETE') {
    console.log('\nReset cancelled. No data was deleted.\n');
    return;
  }

  const ready = (await ask('Please make sure the ReportGen server is NOT running.\nType YES when the server is stopped: ')).trim();
  if (ready.toUpperCase() !== 'YES') {
    console.log('\nReset cancelled. No data was deleted.\n');
    return;
  }

  if (!fs.existsSync(config.dbPath)) {
    console.log(`\nNo database found at:\n${config.dbPath}\n`);
    console.log('ReportGen is already in a fresh state.\n');
    return;
  }

  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  if (fs.existsSync(config.dbPath)) {
    throw new Error('Could not delete the database. Make sure the server is stopped.');
  }

  console.log('\nDatabase reset successfully.\n');
  console.log('Start ReportGen with start-server.bat and the first-run setup will appear.\n');
}

main()
  .catch(err => {
    console.error(`\nReset failed: ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
