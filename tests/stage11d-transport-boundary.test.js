const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.REPORTGEN_DATA_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'reportgen-11d-'));
process.env.REPORTGEN_HOST = '0.0.0.0';
process.env.REPORTGEN_REVERSE_PROXY = '1';
process.env.REPORTGEN_HTTPS = '1';
process.env.REPORTGEN_LOCAL_HOSTNAME = 'reportgen.local';
process.env.REPORTGEN_HTTPS_PORT = '443';

const config = require('../server/config');
const transport = require('../server/security/transport');
const headersSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'security', 'headers.js'), 'utf8');
const proxySource = fs.readFileSync(path.join(__dirname, '..', 'server', 'deployment', 'reverseProxy.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function mockRes() {
  return { statusCode: 200, body: '', status(code) { this.statusCode = code; return this; }, send(value) { this.body = value; return this; }, json(value) { this.body = JSON.stringify(value); return this; } };
}

test('configured hostname is accepted and attacker Host is rejected', () => {
  assert.equal(transport.isAllowedHostHeader('reportgen.local'), true);
  assert.equal(transport.isAllowedHostHeader('reportgen.local:443'), true);
  assert.equal(transport.isAllowedHostHeader('evil.example'), false);
  assert.equal(transport.isAllowedHostHeader('reportgen.local.evil.example'), false);
  const res = mockRes();
  let called = false;
  transport.requireAllowedHost({ headers: { host: 'evil.example' } }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 400);
});

test('allowed HTTPS origin is exact and arbitrary origins are rejected', () => {
  assert.equal(transport.originAllowed('https://reportgen.local'), true);
  assert.equal(transport.originAllowed('https://reportgen.local.evil.example'), false);
  assert.equal(transport.originAllowed('https://evil.example'), false);
  assert.equal(transport.originAllowed('null'), false);
  assert.equal(transport.originAllowed(''), true);
});

test('transport configuration defaults to HTTPS LAN protection', () => {
  assert.equal(config.reverseProxy, true);
  assert.equal(config.httpsEnabled, true);
  assert.equal(config.allowInsecureLan, false);
  assert.equal(config.localHostname, 'reportgen.local');
  assert.equal(config.host, '0.0.0.0');
});

test('security headers include anti-sniffing, framing, referrer, permissions and CSP controls', () => {
  assert.match(headersSource, /X-Content-Type-Options/);
  assert.match(headersSource, /X-Frame-Options.*DENY/);
  assert.match(headersSource, /Referrer-Policy/);
  assert.match(headersSource, /Permissions-Policy/);
  assert.match(headersSource, /Content-Security-Policy/);
  assert.match(headersSource, /frame-ancestors 'none'/);
  assert.match(headersSource, /Strict-Transport-Security/);
});

test('reverse proxy validates Host before redirecting or forwarding', () => {
  assert.match(proxySource, /requireAllowedHost\(req, res/);
  assert.match(proxySource, /isAllowedHostHeader\(req\.headers\.host\)/);
  assert.doesNotMatch(proxySource, /Location:\s*`https:\/\/\$\{req\.headers\.host/);
});

test('API has explicit origin policy and no permissive CORS header', () => {
  assert.match(serverSource, /enforceOriginPolicy/);
  assert.match(serverSource, /app\.use\('\/api', enforceOriginPolicy\)/);
  assert.doesNotMatch(serverSource, /Access-Control-Allow-Origin.*\*/);
});

test('certificate route exposes only the public CA certificate path', () => {
  assert.match(serverSource, /reportgen-local-ca\.cer/);
  assert.doesNotMatch(serverSource, /reportgen-local-server\.pfx/);
  assert.doesNotMatch(serverSource, /reportgen-local-pfx\.credential/);
});

console.log('STAGE11D_TRANSPORT_BOUNDARY_TEST_PASS');
