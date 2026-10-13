const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const config = require('../config');
const { requireAllowedHost, isAllowedHostHeader } = require('../security/transport');
const { info, warn, error: logError, safeError } = require('../security/logger');

function readTlsOptions() {
  if (config.tlsPfx) {
    return { pfx: fs.readFileSync(config.tlsPfx), passphrase: config.tlsPfxPassword || undefined };
  }
  if (config.tlsKey && config.tlsCert) {
    return { key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert) };
  }
  throw new Error('HTTPS requires REPORTGEN_TLS_PFX or REPORTGEN_TLS_KEY and REPORTGEN_TLS_CERT.');
}

function proxyRequest(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${config.port}` };
  headers['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
  headers['x-forwarded-host'] = req.headers.host || config.localHostname;
  headers['x-forwarded-port'] = String(req.socket.localPort || (req.socket.encrypted ? config.httpsPort : config.httpPort));
  headers['x-forwarded-for'] = req.socket.remoteAddress || '';

  const upstream = http.request({ hostname: '127.0.0.1', port: config.port, method: req.method, path: req.url, headers }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', err => { if (!res.headersSent) res.writeHead(502); res.end('ReportGen proxy error.'); logError('proxy.upstream_error', { error: safeError(err) }); });
  req.pipe(upstream);
}

function startReverseProxy() {
  if (!config.reverseProxy) return [];
  const servers = [];
  const tlsOptions = config.httpsEnabled ? readTlsOptions() : null;
  if (tlsOptions) {
    // tlsOptions MUST be the first argument. Without it Node starts a TLS
    // server with no certificate and every browser handshake fails with
    // ERR_SSL_VERSION_OR_CIPHER_MISMATCH.
    const httpsServer = https.createServer(tlsOptions, (req, res) => requireAllowedHost(req, res, () => proxyRequest(req, res)));
    httpsServer.on('tlsClientError', (err) => warn('proxy.tls_client_error', { error: safeError(err) }));
    httpsServer.listen(config.httpsPort, config.host, () => info('proxy.https.started', { host: config.host, port: config.httpsPort }));
    servers.push(httpsServer);
  }
  const isAllowedHost = (req, res) => {
    if (!isAllowedHostHeader(req.headers.host)) { res.statusCode = 400; res.end('Invalid ReportGen host.'); return false; }
    return true;
  };
  const httpServer = http.createServer((req, res) => {
    if (!isAllowedHost(req, res)) return;
    if (config.httpsEnabled) {
      // The server certificate is issued to the configured .local host name,
      // not to a changing Ethernet/Wi-Fi IP address. Redirect every HTTP
      // request to that certificate-matching name.
      const host = config.localHostname;
      res.writeHead(301, { Location: `https://${host}${config.httpsPort === 443 ? '' : `:${config.httpsPort}`}${req.url}` });
      return res.end();
    }
    proxyRequest(req, res);
  });
  httpServer.listen(config.httpPort, config.host, () => info('proxy.http.started', { host: config.host, port: config.httpPort }));
  servers.push(httpServer);
  return servers;
}

module.exports = { startReverseProxy };
