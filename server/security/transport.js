const net = require('node:net');
const config = require('../config');

function stripHostPort(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 255) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end === -1) return '';
    const rest = raw.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return '';
    return raw.slice(1, end).toLowerCase();
  }
  const parts = raw.split(':');
  if (parts.length > 2) return '';
  if (parts.length === 2 && !/^\d{1,5}$/.test(parts[1])) return '';
  return parts[0].toLowerCase();
}

function normalizeHostname(value) {
  return stripHostPort(value).replace(/\.$/, '');
}

function configuredHostname() {
  return normalizeHostname(config.localHostname);
}

function isAllowedHostHeader(value) {
  const host = normalizeHostname(value);
  if (!host) return false;
  const configured = configuredHostname();
  if (host === configured) return true;
  if (config.isLoopback && ['localhost', '127.0.0.1', '::1'].includes(host)) return true;
  return false;
}

function requireAllowedHost(req, res, next) {
  if (!isAllowedHostHeader(req.headers.host)) {
    // The HTTPS reverse proxy passes a raw Node ServerResponse (no Express
    // helpers). Calling res.status() there throws, and an uncaught exception
    // shuts the whole server down - so fall back to the plain Node API.
    if (typeof res.status === 'function') return res.status(400).send('Invalid ReportGen host.');
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Invalid ReportGen host.');
  }
  next();
}

function allowedOrigins() {
  const origins = new Set();
  const hostname = configuredHostname();
  const add = (scheme, host, port, defaultPort) => {
    if (!host) return;
    origins.add(`${scheme}://${host}${port && port !== defaultPort ? `:${port}` : ''}`);
  };

  if (config.reverseProxy) {
    if (config.httpsEnabled) add('https', hostname, config.httpsPort, 443);
    if (!config.httpsEnabled) add('http', hostname, config.httpPort, 80);
  } else {
    add('http', '127.0.0.1', config.port, 80);
    add('http', 'localhost', config.port, 80);
    if (!config.isLoopback) {
      for (const item of config.getLanAddresses()) add('http', item.address, config.port, 80);
    }
  }
  return origins;
}

function originAllowed(origin) {
  if (!origin) return true;
  if (origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    return allowedOrigins().has(parsed.origin);
  } catch {
    return false;
  }
}

function enforceOriginPolicy(req, res, next) {
  const origin = req.get('origin');
  if (!originAllowed(origin)) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  next();
}

function allowedHttpsOrigin() {
  const hostname = configuredHostname();
  const port = config.httpsPort === 443 ? '' : `:${config.httpsPort}`;
  return `https://${hostname}${port}`;
}

module.exports = {
  normalizeHostname,
  isAllowedHostHeader,
  requireAllowedHost,
  allowedOrigins,
  originAllowed,
  enforceOriginPolicy,
  allowedHttpsOrigin
};
