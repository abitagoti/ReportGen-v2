const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = fs.readFileSync(path.join(__dirname, '..', 'server', 'auth', 'authRoutes.js'), 'utf8');
const limiter = fs.readFileSync(path.join(__dirname, '..', 'server', 'security', 'rateLimiter.js'), 'utf8');
const session = fs.readFileSync(path.join(__dirname, '..', 'server', 'auth', 'sessionService.js'), 'utf8');
const middleware = fs.readFileSync(path.join(__dirname, '..', 'server', 'auth', 'middleware.js'), 'utf8');
const reset = fs.readFileSync(path.join(__dirname, '..', 'server', 'tools', 'resetPassword.js'), 'utf8');

test('login has both IP and username throttling', () => {
  assert.match(auth, /const loginLimit = rateLimit\(\{ windowMs: loginWindowMs, max: 10 \}\)/);
  assert.match(auth, /const usernameLoginLimit = rateLimit\(\{/);
  assert.match(auth, /max: 5/);
  assert.match(auth, /keyGenerator: req => .*req\.body\?\.username/);
  assert.match(auth, /router\.post\('\/api\/auth\/login', loginLimit, usernameLoginLimit/);
});

test('login performs dummy password verification for unknown usernames', () => {
  assert.match(auth, /DUMMY_PASSWORD_HASH = hashPassword\(/);
  assert.match(auth, /user\s*\?\s*verifyPassword\(password, user\.password_hash\)\s*:\s*verifyPassword\(password, DUMMY_PASSWORD_HASH\)/s);
  assert.match(auth, /Invalid username or password/);
});

test('rate limiter supports a custom identity key', () => {
  assert.match(limiter, /function rateLimit\(\{ windowMs, max, keyGenerator \}\)/);
  assert.match(limiter, /typeof keyGenerator === 'function' \? keyGenerator\(req\) : req\.ip/);
});

test('session cookie is hardened against cross-site sending', () => {
  assert.match(auth, /httpOnly: true/);
  assert.match(auth, /sameSite: 'strict'/);
  assert.match(auth, /secure: secureRequest\(req\)/);
  assert.match(auth, /maxAge: config\.sessionTtlMs/);
});

test('session validation rejects inactive or expired users and sessions', () => {
  assert.match(session, /!row\.is_active/);
  assert.match(session, /new Date\(row\.expires_at\)\.getTime\(\) <= Date\.now\(\)/);
  assert.match(session, /DELETE FROM sessions WHERE id = \?/);
});

test('state-changing authenticated requests require CSRF', () => {
  assert.match(middleware, /const safe = \['GET', 'HEAD', 'OPTIONS'\]/);
  assert.match(middleware, /x-csrf-token/);
  assert.match(middleware, /Invalid CSRF token/);
});

test('password recovery invalidates all sessions for the reset user', () => {
  assert.match(reset, /UPDATE users SET password_hash = \?, updated_at = \?/);
  assert.match(reset, /DELETE FROM sessions WHERE user_id = \?/);
});

console.log('STAGE11A_AUTH_HARDENING_PASS');
