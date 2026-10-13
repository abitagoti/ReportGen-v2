const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const logDir = path.join(config.dataDir, 'logs');
const logFile = path.join(logDir, 'reportgen-server.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function ensureLogDir() {
  try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
}

function scrub(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  return value
    .replace(/(password|passphrase|token|authorization|cookie|secret|private[_ -]?key|pfx)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:reportgen_session|csrfToken)=?[^;\s]+/gi, '$&'.replace(/=.*/, '=[REDACTED]'));
}

function safeError(error) {
  if (!error) return { message: 'Unknown error' };
  return {
    name: scrub(String(error.name || 'Error')).slice(0, 120),
    message: scrub(String(error.message || error)).slice(0, 1000),
    code: scrub(String(error.code || '')).slice(0, 120) || undefined,
    stack: process.env.REPORTGEN_DEBUG_LOGS === '1' ? scrub(String(error.stack || '')).slice(0, 5000) : undefined
  };
}

function write(level, message, meta = {}) {
  ensureLogDir();
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: scrub(String(message)).slice(0, 2000),
    ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, typeof v === 'string' ? scrub(v).slice(0, 1000) : v]))
  };
  const line = JSON.stringify(entry) + '\n';
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
      fs.renameSync(logFile, `${logFile}.1`);
    }
    fs.appendFileSync(logFile, line, { encoding: 'utf8', mode: 0o600 });
  } catch {}
  if (process.env.REPORTGEN_DEBUG_CONSOLE === '1') {
    process.stderr.write(line);
  }
}

function requestId(req) {
  if (!req.reportgenRequestId) req.reportgenRequestId = crypto.randomUUID();
  return req.reportgenRequestId;
}

function requestLogger(req, res, next) {
  const id = requestId(req);
  res.setHeader('X-Request-ID', id);
  const started = Date.now();
  res.once('finish', () => {
    const durationMs = Date.now() - started;
    write('info', 'request.completed', { requestId: id, method: req.method, path: req.path, status: res.statusCode, durationMs });
  });
  next();
}

module.exports = { logFile, requestId, requestLogger, safeError, info: (m, meta) => write('info', m, meta), warn: (m, meta) => write('warn', m, meta), error: (m, meta) => write('error', m, meta) };
