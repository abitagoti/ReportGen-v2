const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-transport-'));
process.env.REPORTGEN_HOST = '0.0.0.0';
process.env.REPORTGEN_REVERSE_PROXY = '1';
process.env.REPORTGEN_HTTPS = '1';
process.env.REPORTGEN_ALLOW_INSECURE_LAN = '0';

const express = require('express');
const { db } = require('../server/database/database');
const { cookieMiddleware } = require('../server/lib/cookies');
const { hashPassword } = require('../server/auth/passwordService');
const authRoutes = require('../server/auth/authRoutes');
const { securityHeaders } = require('../server/security/headers');

const now = new Date().toISOString();
db.prepare(`INSERT INTO companies (id,name,currency,created_at,updated_at) VALUES (?,?,?,?,?)`).run('co1', 'Transport Test Co', 'NGN', now, now);
db.prepare(`INSERT INTO users (id,company_id,username,display_name,password_hash,role,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run('u1', 'co1', 'admin', 'Admin', hashPassword('CorrectHorseBattery1!'), 'administrator', 1, now, now);

const app = express();
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(express.json());
app.use(cookieMiddleware);
app.use(authRoutes);

let server;
test.before(async () => {
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
});
test.after(() => server?.close());

async function login(forwardedProto) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-proto': forwardedProto
    },
    body: JSON.stringify({ username: 'admin', password: 'CorrectHorseBattery1!' })
  });
  return response;
}

test('LAN HTTP login is rejected when insecure LAN access is not explicitly enabled', async () => {
  const response = await login('http');
  assert.equal(response.status, 426);
  assert.match(await response.text(), /secure HTTPS connection is required/i);
});

test('LAN HTTPS login succeeds and marks the session cookie Secure', async () => {
  const response = await login('https');
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie') || '';
  assert.match(setCookie, /reportgen_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  // Stage 11A hardened the session cookie from Lax to Strict.
  assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);
});

test('HTTPS responses include HSTS', async () => {
  const response = await login('https');
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
});
