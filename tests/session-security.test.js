const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sessionService = fs.readFileSync(path.join(__dirname,'..','server','auth','sessionService.js'),'utf8');
const authRoutes = fs.readFileSync(path.join(__dirname,'..','server','auth','authRoutes.js'),'utf8');

assert.match(sessionService, /LAST_SEEN_WRITE_INTERVAL_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
assert.match(sessionService, /UPDATE sessions SET last_seen_at/);
assert.match(sessionService, /Date\.now\(\)\s*-\s*lastSeenMs\s*>?=\s*LAST_SEEN_WRITE_INTERVAL_MS/);
assert.match(sessionService, /DELETE FROM sessions WHERE expires_at <= \?/);
assert.match(sessionService, /setInterval\(cleanupExpiredSessions, 60 \* 60 \* 1000\)/);
assert.match(authRoutes, /maxAge:\s*config\.sessionTtlMs/);
console.log('SESSION_SECURITY_TEST_PASS');
