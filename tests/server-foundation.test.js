const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
// Isolate this test run from the real persistent database: this MUST be set
// before server/config is required anywhere in this process.
process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-test-'));

test('server foundation package loads its configuration', () => {
  const config = require('../server/config');
  assert.equal(typeof config.port, 'number');
  assert.equal(typeof config.dbPath, 'string');
});

test('password service hashes and verifies passwords', () => {
  const { hashPassword, verifyPassword } = require('../server/auth/passwordService');
  const stored = hashPassword('CorrectHorseBattery1!');
  assert.notEqual(stored, 'CorrectHorseBattery1!');
  assert.equal(verifyPassword('CorrectHorseBattery1!', stored), true);
  assert.equal(verifyPassword('wrong-password', stored), false);
});
