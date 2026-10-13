const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const salesSource = fs.readFileSync(path.join(root, 'server/sales/salesRoutes.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'server/database/databaseRoutes.js'), 'utf8');
const protectionSource = fs.readFileSync(path.join(root, 'server/security/resourceProtection.js'), 'utf8');
const reportsSource = fs.readFileSync(path.join(root, 'server/reports/reportsRoutes.js'), 'utf8');

test('global request bodies have explicit resource bounds', () => {
  assert.match(serverSource, /express\.json\(\{\s*limit:\s*'2mb'/);
  assert.match(serverSource, /express\.urlencoded\(\{\s*extended:\s*false,\s*limit:\s*'256kb'/);
  assert.match(serverSource, /parameterLimit:\s*200/);
});

test('API request rate limiter has a bounded bucket map', () => {
  assert.match(protectionSource, /MAX_TRACKED_BUCKETS\s*=\s*10000/);
  assert.match(protectionSource, /buckets\.size\s*>=\s*MAX_TRACKED_BUCKETS/);
});

test('sales workbook processing is single-flight and multipart bounded', () => {
  assert.match(salesSource, /concurrencyLimit\('sales-import',\s*1\)/);
  assert.match(salesSource, /fileSize:MAX_IMPORT_FILE_BYTES/);
  assert.match(salesSource, /files:1/);
  assert.match(salesSource, /fields:20/);
  assert.match(salesSource, /fieldSize:64\*1024/);
  assert.match(salesSource, /parts:24/);
});

test('database backup upload is bounded by file, field, and part limits', () => {
  assert.match(dbSource, /files:1/);
  assert.match(dbSource, /fileSize:10\*1024\*1024\*1024/);
  assert.match(dbSource, /fields:8/);
  assert.match(dbSource, /fieldSize:64\*1024/);
  assert.match(dbSource, /parts:12/);
});

test('upload/body limit errors are returned as 413', () => {
  assert.match(serverSource, /err\?\.code === 'LIMIT_FILE_SIZE'.*status\(413\)/s);
  assert.match(serverSource, /err\?\.code === 'LIMIT_PART_COUNT'.*status\(413\)/s);
  assert.match(serverSource, /err\?\.type === 'entity\.too\.large'.*status\(413\)/s);
});

test('long-running server keeps a bounded connection policy', () => {
  assert.match(serverSource, /appServer\.requestTimeout\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  assert.match(serverSource, /appServer\.headersTimeout\s*=\s*35\s*\*\s*1000/);
  assert.match(serverSource, /appServer\.keepAliveTimeout\s*=\s*5\s*\*\s*1000/);
});


test('expensive owner report ranges are bounded', () => {
  assert.match(reportsSource, /requestedMonths\.length\s*>\s*24/);
  assert.match(reportsSource, /Report range is limited to 24 months per request/);
  assert.match(reportsSource, /concurrencyLimit\('report-export',\s*2\)/);
});
