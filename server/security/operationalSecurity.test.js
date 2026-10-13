const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const logger = require('./logger');

const sample = 'password=Secret123 token=abc authorization=Bearer xyz private_key=hidden pfx=topsecret';
const scrubbed = logger.safeError(new Error(sample));
assert.match(scrubbed.message, /password=\[REDACTED\]/);
assert.match(scrubbed.message, /token=\[REDACTED\]/);
assert.match(scrubbed.message, /authorization=\[REDACTED\]/);
assert.match(scrubbed.message, /private_key=\[REDACTED\]/);
assert.match(scrubbed.message, /pfx=\[REDACTED\]/);

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(serverSource, /requestLogger/);
assert.match(serverSource, /Malformed JSON request/);
assert.match(serverSource, /request\.failed/);
assert.doesNotMatch(serverSource, /console\.error\(err\)/);
assert.match(serverSource, /process\.on\('uncaughtException'/);
assert.match(serverSource, /process\.on\('unhandledRejection'/);

const proxySource = fs.readFileSync(path.join(__dirname, '..', 'deployment', 'reverseProxy.js'), 'utf8');
assert.doesNotMatch(proxySource, /console\.error\(/);
assert.match(proxySource, /proxy\.upstream_error/);

logger.info('operational-security-test', { requestId: 'test-request-id' });
assert.ok(fs.existsSync(logger.logFile), 'structured log file should be created');
const lines = fs.readFileSync(logger.logFile, 'utf8').trim().split(/\n+/);
const latest = JSON.parse(lines.at(-1));
assert.equal(latest.message, 'operational-security-test');

console.log('Stage 11F operational security tests: PASS');
