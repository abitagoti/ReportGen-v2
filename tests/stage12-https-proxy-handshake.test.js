// Regression: the HTTPS reverse proxy must actually present its certificate.
// A previous build created the HTTPS server without passing the TLS options, so
// every browser failed with ERR_SSL_VERSION_OR_CIPHER_MISMATCH. These tests
// perform a real TLS handshake. The key in tests/fixtures is a throw-away
// TEST-ONLY certificate and is never used by the application.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function request(lib, port, hostHeader, options = {}) {
  return new Promise((resolve, reject) => {
    const req = lib.request({ host: '127.0.0.1', port, path: '/', method: 'GET', agent: false, rejectUnauthorized: false, headers: { host: hostHeader }, ...options }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, cert: res.socket.getPeerCertificate?.() }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

test('HTTPS proxy completes a TLS handshake, enforces the Host policy and forwards to the app', async (t) => {
  const [appPort, httpPort, httpsPort] = [await freePort(), await freePort(), await freePort()];
  const keyPath = path.join(__dirname, 'fixtures', 'tls-test-only.key');
  const certPath = path.join(__dirname, 'fixtures', 'tls-test-only.crt');
  Object.assign(process.env, {
    REPORTGEN_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'reportgen-https-proxy-')),
    REPORTGEN_HOST: '127.0.0.1', REPORTGEN_PORT: String(appPort),
    REPORTGEN_REVERSE_PROXY: '1', REPORTGEN_HTTPS: '1',
    REPORTGEN_HTTP_PORT: String(httpPort), REPORTGEN_HTTPS_PORT: String(httpsPort),
    REPORTGEN_LOCAL_HOSTNAME: 'reportgen.local',
    REPORTGEN_TLS_KEY: keyPath, REPORTGEN_TLS_CERT: certPath
  });
  const upstream = http.createServer((req, res) => res.end('upstream ok'));
  await new Promise((resolve) => upstream.listen(appPort, '127.0.0.1', resolve));
  const { startReverseProxy } = require('../server/deployment/reverseProxy');
  const servers = startReverseProxy();
  t.after(() => { for (const s of servers) { s.close(); s.closeAllConnections?.(); } upstream.close(); upstream.closeAllConnections?.(); });
  await Promise.all(servers.map((s) => s.listening ? null : new Promise((resolve) => s.once('listening', resolve))));

  const ok = await request(https, httpsPort, `reportgen.local:${httpsPort}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body, 'upstream ok');
  assert.match(ok.cert.subject.CN, /reportgen\.local/, 'server must present the configured certificate');

  const byIp = await request(https, httpsPort, `10.10.110.3:${httpsPort}`);
  assert.equal(byIp.status, 400, 'IP-address Host headers must stay rejected');

  const redirect = await request(http, httpPort, `reportgen.local:${httpPort}`);
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, `https://reportgen.local:${httpsPort}/`);

  const redirectByIp = await request(http, httpPort, `10.10.110.3:${httpPort}`);
  assert.equal(redirectByIp.status, 400);
});
