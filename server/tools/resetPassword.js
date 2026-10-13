const readline = require('node:readline');
const config = require('../config');
const { db } = require('../database/database');
const { hashPassword } = require('../auth/passwordService');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n========================================');
  console.log('ReportGen Password Recovery');
  console.log('========================================\n');
  console.log(`Database: ${config.dbPath}\n`);

  const username = (await ask('Username: ')).trim();
  if (!username) throw new Error('Username is required.');

  const user = db.prepare(
    `SELECT id, username, display_name, role, is_active FROM users WHERE username = ? LIMIT 1`
  ).get(username);

  if (!user) throw new Error(`No user was found with username "${username}" in this ReportGen database.`);
  if (!user.is_active) throw new Error('That user account is inactive.');

  console.log(`\nAccount: ${user.display_name} (${user.role})`);
  const password = await ask('New password (minimum 8 characters): ');
  const confirm = await ask('Confirm new password: ');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (password !== confirm) throw new Error('Passwords do not match.');

  const passwordHash = hashPassword(password);
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(passwordHash, now, user.id);
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
  })();

  console.log('\nPassword reset successfully.');
  console.log('Existing sessions for this user have been invalidated.');
  console.log('You can now sign in with the new password.\n');
}

main()
  .catch(err => {
    console.error(`\nRecovery failed: ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
