const path = require('node:path');
const os = require('node:os');

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function validPort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return port;
}

const port = validPort(process.env.REPORTGEN_PORT || 4310, 'REPORTGEN_PORT');
// Safe by default: only bind beyond loopback if an operator explicitly opts in
// via REPORTGEN_HOST (e.g. REPORTGEN_HOST=0.0.0.0 for LAN use). This app holds
// payroll/salary data, so it should not be reachable on the network unless
// someone decided that on purpose.
const host = process.env.REPORTGEN_HOST || '127.0.0.1';
function defaultDataDir() {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'ReportGen', 'data');
  if (process.env.XDG_DATA_HOME) return path.join(process.env.XDG_DATA_HOME, 'ReportGen');
  return path.join(os.homedir(), '.reportgen', 'data');
}

// Keep persistent data outside the extracted application folder so updates do not
// silently switch databases when the app is unpacked into a different directory.
const dataDir = process.env.REPORTGEN_DATA_DIR || defaultDataDir();
const dataDirSource = process.env.REPORTGEN_DATA_DIR ? 'REPORTGEN_DATA_DIR' : 'stable-user-data';
const reverseProxy = envBool('REPORTGEN_REVERSE_PROXY');
const httpsEnabled = envBool('REPORTGEN_HTTPS');
// Plain HTTP LAN access is deliberately opt-in. Production/LAN deployments
// should use the HTTPS reverse proxy so credentials and session cookies are
// never sent over the network in clear text.
const allowInsecureLan = envBool('REPORTGEN_ALLOW_INSECURE_LAN');
const httpPort = validPort(process.env.REPORTGEN_HTTP_PORT || 80, 'REPORTGEN_HTTP_PORT');
const httpsPort = validPort(process.env.REPORTGEN_HTTPS_PORT || 443, 'REPORTGEN_HTTPS_PORT');
const localHostname = String(process.env.REPORTGEN_LOCAL_HOSTNAME || 'reportgen.local').trim().toLowerCase();
if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/.test(localHostname)) {
  throw new Error('REPORTGEN_LOCAL_HOSTNAME must be a valid .local hostname such as reportgen.local.');
}
const tlsKey = process.env.REPORTGEN_TLS_KEY || '';
const tlsCert = process.env.REPORTGEN_TLS_CERT || '';
const tlsPfx = process.env.REPORTGEN_TLS_PFX || '';
const tlsPfxPassword = process.env.REPORTGEN_TLS_PFX_PASSWORD || '';

const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(host);

if (!isLoopback && !httpsEnabled && !reverseProxy) {
  console.warn('[SECURITY] ReportGen is exposed beyond loopback without HTTPS. Use only on a trusted LAN or configure TLS.');
}

function getLanAddresses() {
  const addresses = [];
  const browserScheme = httpsEnabled ? 'https' : 'http';
  const browserPort = httpsEnabled ? httpsPort : httpPort;
  for (const [interfaceName, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const endpointHost = reverseProxy ? localHostname : entry.address;
      const endpointPort = reverseProxy ? browserPort : port;
      const endpointScheme = reverseProxy ? browserScheme : 'http';
      const defaultPort = endpointScheme === 'https' ? 443 : 80;
      const portPart = endpointPort === defaultPort ? '' : `:${endpointPort}`;
      addresses.push({
        interface: interfaceName,
        address: entry.address,
        url: `${endpointScheme}://${endpointHost}${portPart}`
      });
    }
  }
  return addresses;
}

function getBrowserUrl() {
  const scheme = reverseProxy ? (httpsEnabled ? 'https' : 'http') : 'http';
  const targetPort = reverseProxy ? (httpsEnabled ? httpsPort : httpPort) : port;
  const hostName = reverseProxy
    ? localHostname
    : (!isLoopback ? getLanAddresses()[0]?.address : '127.0.0.1');
  if (!hostName) return '';
  const defaultPort = scheme === 'https' ? 443 : 80;
  return `${scheme}://${hostName}${targetPort === defaultPort ? '' : `:${targetPort}`}`;
}

module.exports = {
  port,
  host,
  dataDir,
  dataDirSource,
  dbPath: path.join(dataDir, 'reportgen.sqlite'),
  sessionTtlMs: 8 * 60 * 60 * 1000,
  reverseProxy,
  httpsEnabled,
  allowInsecureLan,
  httpPort,
  httpsPort,
  localHostname,
  tlsKey,
  tlsCert,
  tlsPfx,
  tlsPfxPassword,
  isLoopback,
  getLanAddresses,
  publicConfig() {
    return {
      host,
      port,
      reverseProxy,
      httpsEnabled,
      allowInsecureLan,
      httpPort,
      httpsPort,
      localHostname,
      isLoopback,
      browserUrl: getBrowserUrl(),
      lanAddresses: getLanAddresses(),
      dataDir,
      dataDirSource
    };
  }
};
