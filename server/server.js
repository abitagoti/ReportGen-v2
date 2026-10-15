const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { cookieMiddleware } = require('./lib/cookies');
const config = require('./config');
const { health } = require('./database/database');
const { securityHeaders } = require('./security/headers');
const { requireAuth, requireCsrf } = require('./auth/middleware');
const { startReverseProxy } = require('./deployment/reverseProxy');
const { apiRateLimit } = require('./security/resourceProtection');
const { enforceOriginPolicy } = require('./security/transport');
const { requestLogger, requestId, safeError, info, error: logError } = require('./security/logger');
const { startLocalHostnameService, stopLocalHostnameService } = require('./network/hostnameService');

const setupRoutes = require('./setup/setupRoutes');
const authRoutes = require('./auth/authRoutes');
const companyRoutes = require('./company/companyRoutes');
const businessRoutes = require('./businesses/businessRoutes');
const userRoutes = require('./users/userRoutes');
const auditRoutes = require('./audit/auditRoutes');
const salesRoutes = require('./sales/salesRoutes');
const legalRoutes = require('./legal/legalRoutes');
const capitalRoutes = require('./capital/capitalRoutes');
const vendorPaymentRoutes = require('./vendor/vendorPaymentRoutes');
const dashboardRoutes = require('./dashboard/dashboardRoutes');
const messageRoutes = require('./messages/messageRoutes');
const configurationRoutes = require('./configuration/configurationRoutes');
const accountantRoutes = require('./accountant/accountantRoutes');
const payrollRoutes = require('./payroll/payrollRoutes');
const organizationRoutes = require('./organizationRoutes');
const permissionsRoutes = require('./permissionsRoutes');
const reportsRoutes = require('./reports/reportsRoutes');
const databaseRoutes = require('./database/databaseRoutes');
const { startMonthlyBackupScheduler, stopMonthlyBackupScheduler } = require('./database/backupScheduler');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.reverseProxy ? 1 : false);

app.use(securityHeaders);
app.use(requestLogger);
app.use(express.json({ limit: '2mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '256kb', parameterLimit: 200 }));
// Keep ordinary API traffic bounded so a single client cannot monopolize the local server.
app.use('/api', apiRateLimit({ name: 'api', max: 180 }));
app.use('/api', enforceOriginPolicy);
app.use(cookieMiddleware);

// Browser client: the same server hosts the ReportGen web UI.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ service: 'reportgen-server', build: `reportgen-server@${require('../package.json').version}`, permissionsRoutes: true, ...health() });
});

app.get('/network/secure-connection', (req, res) => {
  const securePort = config.httpsPort === 443 ? '' : `:${config.httpsPort}`;
  const secureUrl = `https://${config.localHostname}${securePort}`;
  res.type('html').send(`<!doctype html><html><head><meta charset=\"utf-8\"><title>ReportGen Secure Connection</title></head><body><h1>ReportGen Secure Connection</h1><p>Download the public CA certificate, install it as a trusted root on this device, then open <a href=\"${secureUrl}\">${secureUrl}</a>.</p><p><a href=\"/network/reportgen-local-ca.cer\">Download ReportGen CA certificate</a></p><p>Only the public CA certificate is distributed. Never distribute the server PFX or private key.</p></body></html>`);
});

app.get('/network/reportgen-local-ca.cer', (req, res) => {
  // The Electron setup wizard keeps generated certificates beside its
  // persistent app data, not inside the installed Program Files directory.
  // Keep the project-folder fallback for manually configured deployments.
  const userDataCa = path.join(config.dataDir, 'certificates', 'reportgen-local-ca.cer');
  const projectCa = path.join(__dirname, '..', 'config', 'certificates', 'reportgen-local-ca.cer');
  const caPath = fs.existsSync(userDataCa) ? userDataCa : projectCa;
  if (!fs.existsSync(caPath)) return res.status(404).send('ReportGen CA certificate has not been generated.');
  res.download(caPath, 'reportgen-local-ca.cer');
});

app.use(setupRoutes);
app.use(authRoutes);

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/setup') || req.path.startsWith('/auth/login') || req.path === '/legal/documents') {
    return next();
  }
  requireAuth(req, res, next);
});

app.use((req, res, next) => {
  if (req.path === '/setup' || req.path.startsWith('/auth/login')) return next();
  requireCsrf(req, res, next);
});

app.use(companyRoutes);
app.use(businessRoutes);
app.use(userRoutes);
app.use(auditRoutes);
app.use(salesRoutes);
app.use(legalRoutes);
app.use(capitalRoutes);
app.use(vendorPaymentRoutes);
app.use(dashboardRoutes);
app.use(messageRoutes);
app.use(configurationRoutes);
app.use(databaseRoutes);
app.use(accountantRoutes);
app.use(payrollRoutes);
app.use(organizationRoutes);
app.use(permissionsRoutes);
app.use(reportsRoutes);

app.get(/^\/(?!api(?:\/|$)).*/, (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Uploaded file exceeds the configured size limit.' });
  if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_PART_COUNT' || err?.code === 'LIMIT_FIELD_COUNT') return res.status(413).json({ error: 'Upload contains too many parts or fields.' });
  if (err?.code === 'LIMIT_FIELD_KEY' || err?.code === 'LIMIT_FIELD_VALUE') return res.status(413).json({ error: 'Upload field is too large.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body exceeds the configured size limit.' });
  const id = requestId(req);
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON request.', requestId: id });
  logError('request.failed', { requestId: id, method: req.method, path: req.path, error: safeError(err) });
  res.status(500).json({ error: 'Internal server error.', requestId: id });
});

const appServer = app.listen(config.port, config.reverseProxy ? '127.0.0.1' : config.host, () => {
  info('server.started', { host: config.reverseProxy ? '127.0.0.1' : config.host, port: config.port, reverseProxy: config.reverseProxy, httpsEnabled: config.httpsEnabled });
  startMonthlyBackupScheduler();
});
// Large database restores stream directly to disk and can take several minutes on LAN.
appServer.requestTimeout = 30 * 60 * 1000;
appServer.headersTimeout = 35 * 1000;
appServer.keepAliveTimeout = 5 * 1000;

const reverseProxyServers = config.reverseProxy ? startReverseProxy() : [];

const hostnameService = process.env.REPORTGEN_MDNS === '0'
  ? { enabled: false, reason: 'disabled-by-environment' }
  : startLocalHostnameService({ hostname: config.localHostname });

function shutdown(signal) {
  info('server.shutdown', { signal });
  stopLocalHostnameService();
  stopMonthlyBackupScheduler();
  for (const proxyServer of reverseProxyServers) {
    if (!proxyServer.listening) continue;
    proxyServer.close();
    proxyServer.closeAllConnections?.();
  }
  appServer.close(() => process.exit(0));
  // A service stop must not wait indefinitely on browser keep-alive or active
  // proxy connections. Current request handlers finish their synchronous DB
  // work before this event loop callback runs; then sockets can be closed.
  appServer.closeAllConnections?.();
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => { logError('process.uncaught_exception', { error: safeError(err) }); shutdown('uncaughtException'); });
process.on('unhandledRejection', (reason) => { logError('process.unhandled_rejection', { error: safeError(reason instanceof Error ? reason : new Error(String(reason))) }); });

app.get('/api/network/hostname-status', (req, res) => {
  res.json({ hostname: config.localHostname, ...hostnameService });
});
