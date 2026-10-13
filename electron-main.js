const { app, BrowserWindow, dialog, shell, session, Menu, ipcMain } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

// Only one copy of ReportGen should ever run at once. If the icon is
// clicked again while an instance is already starting up or running,
// quit this new attempt immediately and focus the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let serverProcess;
let mainWindow;
let splashWindow;
let settingsWindow;
const serverPort = Number(process.env.REPORTGEN_PORT || 4310);
const installTag = 'ReportGen-v2';
const persistentDataDir = path.join(app.getPath('appData'), installTag);
const runtimeLog = path.join(persistentDataDir, 'desktop-startup.log');
const connectionConfigPath = path.join(persistentDataDir, 'connection.json');
const setupConfigPath = path.join(persistentDataDir, 'setup.json');
app.setPath('userData', persistentDataDir);

function log(line) {
  try { fs.mkdirSync(persistentDataDir, { recursive: true }); fs.appendFileSync(runtimeLog, `[${new Date().toISOString()}] ${line}\n`); } catch {}
}

function readCertificatePassword() {
  try {
    const encrypted = fs.readFileSync(path.join(persistentDataDir, 'certificates', 'reportgen-local-pfx.credential'), 'utf8').trim();
    const script = `$s=ConvertTo-SecureString '${encrypted.replace(/'/g, "''")}';$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}`;
    return require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, encoding: 'utf8' }).trim();
  } catch (error) { log(`certificate password could not be loaded: ${error.message}`); return ''; }
}

function getWindowsServiceState(serviceName = 'ReportGenServer') {
  if (process.platform !== 'win32') return 'unsupported';
  const result = spawnSync('sc.exe', ['query', serviceName], {
    windowsHide: true, encoding: 'utf8', timeout: 5000
  });
  if (result.error) return 'unknown';
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (/\b1060\b|does not exist as an installed service/i.test(output)) return 'missing';
  if (result.status !== 0) return 'unknown';
  const match = output.match(/\bSTATE\s*:\s*\d+\s+([A-Z_]+)/i);
  return match ? match[1].toLowerCase() : 'unknown';
}

async function waitForWindowsServiceRunning(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let state = getWindowsServiceState();
  while (state !== 'running' && state !== 'missing' && state !== 'unknown' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    state = getWindowsServiceState();
  }
  return state;
}

// --- Connection settings (local server vs. connect to an existing one) ----
// Default is unchanged from before this feature existed: spawn a private
// local server on loopback. A user only ends up in "remote" mode by opening
// Server Connection settings and choosing it, so upgrading the app does not
// change anyone's behavior.
function readConnectionConfig() {
  try {
    const raw = fs.readFileSync(connectionConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.mode === 'remote' && typeof parsed.serverUrl === 'string' && parsed.serverUrl) {
      return { mode: 'remote', serverUrl: parsed.serverUrl.replace(/\/+$/, '') };
    }
  } catch {}
  return { mode: 'local' };
}

function writeConnectionConfig(config) {
  fs.mkdirSync(persistentDataDir, { recursive: true });
  const toSave = config.mode === 'remote'
    ? { mode: 'remote', serverUrl: config.serverUrl.replace(/\/+$/, '') }
    : { mode: 'local' };
  fs.writeFileSync(connectionConfigPath, JSON.stringify(toSave, null, 2));
}

// Fired in the FIRST instance whenever a second launch attempt happens
// (e.g. the user double-clicks the desktop icon again). Bring the
// existing window to the front instead of doing nothing silently.
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
  } else if (splashWindow) {
    splashWindow.show();
    splashWindow.focus();
  }
});

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 320,
    height: 320,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: path.join(__dirname, 'public', 'assets', 'reportgen.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  splashWindow.loadFile(path.join(__dirname, 'electron-splash.html')).catch((error) => {
    log(`Splash failed to load: ${error.stack || error.message}`);
  });
  splashWindow.once('ready-to-show', () => splashWindow.show());
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function startServer() {
  const nodeExecutable = app.isPackaged ? process.execPath : (process.env.REPORTGEN_NODE_PATH || process.env.npm_node_execpath || 'node');
  const nodeArgs = app.isPackaged ? [path.join(process.resourcesPath, 'app', 'server', 'server.js')] : [path.join(__dirname, 'server', 'server.js')];
  let setup = {};
  try { setup = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8')); } catch {}
  const deployment = setup.mode === 'host' && setup.lan;
  const certificateDir = path.join(persistentDataDir, 'certificates');
  const certificatePassword = setup.https ? readCertificatePassword() : '';
  serverProcess = spawn(nodeExecutable, nodeArgs, {
    // __dirname points inside app.asar once packaged, which isn't a real
    // directory on disk and breaks spawn's cwd on Windows. Use a real
    // unpacked folder instead: resourcesPath when packaged, __dirname in dev.
    cwd: app.isPackaged ? process.resourcesPath : __dirname,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      REPORTGEN_HOST: deployment ? '0.0.0.0' : '127.0.0.1',
      REPORTGEN_PORT: String(serverPort),
      REPORTGEN_DATA_DIR: persistentDataDir,
      REPORTGEN_REVERSE_PROXY: deployment ? '1' : '0',
      REPORTGEN_HTTPS: setup.https ? '1' : '0',
      REPORTGEN_HTTP_PORT: String(setup.httpPort || 80),
      REPORTGEN_HTTPS_PORT: String(setup.httpsPort || 443),
      REPORTGEN_LOCAL_HOSTNAME: setup.hostname || 'reportgen.local',
      REPORTGEN_TLS_PFX: setup.https ? path.join(certificateDir, 'reportgen-local-server.pfx') : '',
      REPORTGEN_TLS_PFX_PASSWORD: certificatePassword
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.on('data', (chunk) => log(String(chunk).trimEnd()));
  serverProcess.stderr.on('data', (chunk) => log(String(chunk).trimEnd()));
  serverProcess.on('error', (error) => { log(`spawn error: ${error.stack || error.message}`); dialog.showErrorBox('ReportGen server error', error.message); });
  serverProcess.on('exit', (code, signal) => { if (code !== 0) log(`server exited code=${code} signal=${signal || ''}`); });
}

// Works against either the private local server (loopback, always HTTP) or a
// remote server the user pointed this client at (which may be HTTP or HTTPS,
// e.g. a reverse-proxied https://reportgen.local deployment).
function waitForServer(targetUrl, attempts = 60) {
  const healthUrl = new URL('/api/health', targetUrl);
  const client = healthUrl.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = client.get(healthUrl, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(500, () => req.destroy());
    };
    const retry = () => {
      if (--attempts <= 0) return reject(new Error(`Could not reach ReportGen at ${targetUrl}.`));
      setTimeout(check, 250);
    };
    check();
  });
}

async function createWindow(targetUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    icon: path.join(__dirname, 'public', 'assets', 'reportgen.ico'),
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log(`Renderer failed to load: ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`Renderer exited: ${JSON.stringify(details)}`);
  });
  const startedAt = Date.now();
  let timeout;
  try {
    await Promise.race([
      mainWindow.loadURL(targetUrl),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('The ReportGen page timed out while loading.')), 60000); })
    ]);
    log(`ReportGen window loaded in ${Date.now() - startedAt}ms from ${targetUrl}`);
  } finally {
    clearTimeout(timeout);
  }
  // Show after the page has loaded, but do not depend exclusively on ready-to-show.
  closeSplashWindow();
  mainWindow.show();
  mainWindow.focus();
}

// --- Server Connection settings window --------------------------------
function openConnectionSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 360,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'ReportGen - Server Connection',
    icon: path.join(__dirname, 'public', 'assets', 'reportgen.ico'),
    parent: mainWindow || undefined,
    modal: !!mainWindow,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'electron-connection-preload.js')
    }
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'electron-connection-settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function openSetupWizard() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show(); settingsWindow.focus(); return;
  }
  settingsWindow = new BrowserWindow({
    width: 720, height: 700, minWidth: 640, minHeight: 620, resizable: true,
    title: 'ReportGen Setup', icon: path.join(__dirname, 'public', 'assets', 'reportgen.ico'),
    parent: mainWindow || undefined, modal: !!mainWindow, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, 'electron-setup-preload.js') }
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'electron-setup-wizard.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function runPowerShell(script, args = [], elevated = false, logFileName = 'windows-setup.log') {
  return new Promise((resolve) => {
    const ps = 'powershell.exe';
    const elevatedLog = path.join(persistentDataDir, logFileName);
    const command = `& ${[script, ...args].map((value) => `'${String(value).replace(/'/g, "''")}'`).join(' ')} *> '${elevatedLog.replace(/'/g, "''")}'; exit $LASTEXITCODE`;
    if (elevated) {
      const encoded = Buffer.from(command, 'utf16le').toString('base64');
      const child = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}') | ForEach-Object { exit $_.ExitCode }`],
      { windowsHide: true, stdio: 'ignore' });
      child.on('error', (error) => resolve({ error: error.message }));
      child.on('exit', (code) => {
        let output = '';
        try { output = fs.readFileSync(elevatedLog, 'utf8').trim(); } catch {}
        resolve(code === 0 ? { ok: true, output } : { error: output || `Windows setup did not finish (code ${code}). If you cancelled the Windows approval prompt, continue without that option and retry later.` });
      });
      return;
    }
    const child = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => resolve({ error: error.message }));
    child.on('exit', (code) => resolve(code === 0 ? { ok: true, output } : { error: output || `Setup failed (code ${code}).` }));
  });
}

function runPowerShellWithEnv(script, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
      windowsHide: true, env: { ...process.env, ...extraEnv }
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => resolve({ error: error.message }));
    child.on('exit', (code) => resolve(code === 0 ? { ok: true, output } : { error: output || `Setup failed (code ${code}).` }));
  });
}

ipcMain.handle('connection:get', () => ({ ...readConnectionConfig(), serviceState: getWindowsServiceState() }));
ipcMain.handle('connection:service-status', () => ({ state: getWindowsServiceState() }));

ipcMain.handle('setup:get', () => {
  let setup = {};
  try { setup = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8')); } catch {}
  let certificateHostname = '';
  try {
    const certificateInfo = JSON.parse(fs.readFileSync(path.join(persistentDataDir, 'certificates', 'reportgen-local-certificate.json'), 'utf8'));
    certificateHostname = String(certificateInfo.hostname || '').toLowerCase();
  } catch {}
  setup.certificateReady = fs.existsSync(path.join(persistentDataDir, 'certificates', 'reportgen-local-server.pfx')) &&
    fs.existsSync(path.join(persistentDataDir, 'certificates', 'reportgen-local-pfx.credential'));
  setup.certificateHostname = certificateHostname;
  return setup;
});
ipcMain.handle('setup:save', (_event, settings) => {
  try {
    let previous = {};
    try { previous = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8')); } catch {}
    fs.mkdirSync(persistentDataDir, { recursive: true });
    const setup = {
      mode: ['local', 'host', 'remote'].includes(settings.mode) ? settings.mode : 'local',
      hostname: String(settings.hostname || 'reportgen.local').trim().toLowerCase(),
      lan: !!settings.lan, https: !!settings.https, service: !!settings.service,
      httpPort: 80, httpsPort: 443, complete: false,
      previousService: !!previous.service
    };
    if (setup.mode === 'remote') {
      writeConnectionConfig({ mode: 'remote', serverUrl: String(settings.serverUrl || '').trim() });
    } else {
      writeConnectionConfig({ mode: 'local' });
    }
    fs.writeFileSync(setupConfigPath, JSON.stringify(setup, null, 2));
    fs.writeFileSync(path.join(persistentDataDir, 'deployment.json'), JSON.stringify({ hostname: setup.hostname, applicationPort: serverPort, httpPort: setup.httpPort, httpsPort: setup.httpsPort, reverseProxy: setup.lan, httpsEnabled: setup.https }, null, 2));
    return { ok: true };
  } catch (error) { return { error: `Could not save setup: ${error.message}` }; }
});
ipcMain.handle('setup:network', async () => {
  const setup = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8'));
  const script = path.join(__dirname, 'scripts', 'configure-reportgen-network.ps1');
  return runPowerShell(script, [setup.hostname, String(setup.httpPort), String(setup.httpsPort)], true);
});
ipcMain.handle('setup:certificates', async (_event, password) => {
  const script = path.join(__dirname, 'scripts', 'generate-local-certificates.ps1');
  const outputDir = path.join(persistentDataDir, 'certificates');
  return runPowerShellWithEnv(script, ['-HostName', JSON.parse(fs.readFileSync(setupConfigPath, 'utf8')).hostname, '-OutputDir', outputDir], { REPORTGEN_SETUP_PFX_PASSWORD: String(password) });
});
ipcMain.handle('setup:service', async () => {
  const setup = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8'));
  if (!setup.service) {
    if (!setup.previousService) return { ok: true };
    const removeScript = path.join(__dirname, 'scripts', 'uninstall-reportgen-service.ps1');
    return runPowerShell(removeScript, [], true);
  }
  if (serverProcess && !serverProcess.killed) {
    const child = serverProcess;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
    serverProcess = null;
  }
  const script = path.join(__dirname, 'scripts', 'install-reportgen-service.ps1');
  const args = ['-Mode', 'Auto', '-DataDir', persistentDataDir, '-NodePath', process.execPath];
  if (setup.https) args.push('-PfxPassword', readCertificatePassword());
  const result = await runPowerShell(script, args, true, 'windows-service-setup.log');
  log(`Windows service installer returned: ${result.error || result.output || 'no output'}`);
  if (result.error) {
    if (setup.mode === 'host' && setup.lan) startServer();
    return result;
  }
  const state = await waitForWindowsServiceRunning();
  log(`Windows service state after installation: ${state}`);
  if (state !== 'running') {
    if (setup.mode === 'host' && setup.lan) startServer();
    return { error: `Windows did not start the ReportGen background service (status: ${state}). Setup is still open. Approve the Windows prompt and try again, or turn off the background-service option to continue with ReportGen running only while the desktop app is open.` };
  }
  return result;
});
ipcMain.handle('setup:finish', () => {
  try {
    const setup = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8'));
    if (setup.mode === 'host' && setup.lan && setup.service && getWindowsServiceState() !== 'running') {
      return { error: 'The Windows background service is not running yet. Setup has been kept open so you can retry the service installation.' };
    }
    delete setup.previousService;
    delete setup.portMigration;
    delete setup.serviceRepair;
    setup.complete = true;
    fs.writeFileSync(setupConfigPath, JSON.stringify(setup, null, 2));
  } catch {}
  app.relaunch(); app.exit(0); return { ok: true };
});
ipcMain.handle('setup:cancel', () => { if (mainWindow) mainWindow.close(); else app.quit(); });

ipcMain.handle('connection:cancel', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

ipcMain.handle('connection:save-and-restart', (_event, config) => {
  try {
    writeConnectionConfig(config);
  } catch (error) {
    return { error: `Could not save settings: ${error.message}` };
  }
  // Applying a mode switch cleanly (stopping/starting the spawned local
  // server, tearing down the current window) is simplest and most reliable
  // as a full relaunch rather than trying to hot-swap state in place.
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

function buildMenu() {
  const template = [
    {
      label: 'ReportGen',
      submenu: [
        { label: 'Server Connection…', click: () => openConnectionSettingsWindow() },
        { label: 'Setup Wizard…', click: () => openSetupWizard() },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function startLocal() {
  let setup = {};
  try { setup = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8')); } catch {}
  if (setup.mode === 'host' && setup.service && setup.lan) {
    const targetUrl = `http://127.0.0.1:${serverPort}`;
    let serviceReady = false;
    try {
      log(`Waiting for configured Windows service at ${targetUrl}`);
      await waitForServer(targetUrl);
      serviceReady = true;
    } catch (error) {
      // A service install may have been cancelled or failed after the wizard
      // saved its preferences. Keep the desktop app usable as a foreground
      // server, and record why the background service was not used.
      log(`Windows service unavailable; starting the local server instead: ${error.message}`);
    }
    if (serviceReady) {
      await createWindow(targetUrl);
      return;
    }
  }
  startServer();
  const targetUrl = `http://127.0.0.1:${serverPort}`;
  await waitForServer(targetUrl);
  await createWindow(targetUrl);
}

async function startRemote(serverUrl) {
  await waitForServer(serverUrl);
  await createWindow(serverUrl);
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    log(`ReportGen starting; packaged=${app.isPackaged}; version=${app.getVersion()}; resources=${process.resourcesPath}`);
    buildMenu();
    // Show a loader right away so clicking the icon always gives immediate
    // feedback, even before the server has started or the window can load.
    createSplashWindow();

    // Do not restore a previous login after the desktop app is closed.
    // Keep other local preferences/data intact and clear only authentication cookies.
    try { await session.defaultSession.clearStorageData({ storages: ['cookies'] }); } catch (error) {
      log(`cookie clear error: ${error.message}`);
    }

    let setup = null;
    try { setup = JSON.parse(fs.readFileSync(setupConfigPath, 'utf8')); } catch {}
    // Migrate the first wizard release's nonstandard ports to standard browser
    // ports. Re-running the wizard also refreshes firewall/service settings.
    if (setup && setup.complete === true && setup.mode === 'host' && setup.lan && setup.httpPort === 8080 && setup.httpsPort === 8443) {
      setup.httpPort = 80;
      setup.httpsPort = 443;
      setup.complete = false;
      setup.portMigration = true;
      fs.writeFileSync(setupConfigPath, JSON.stringify(setup, null, 2));
      try {
        fs.writeFileSync(path.join(persistentDataDir, 'deployment.json'), JSON.stringify({ hostname: setup.hostname || 'reportgen.local', applicationPort: serverPort, httpPort: 80, httpsPort: 443, reverseProxy: !!setup.lan, httpsEnabled: !!setup.https }, null, 2));
      } catch (error) { log(`port migration config error: ${error.message}`); }
      log('Migrating browser addresses to standard ports 80/443; setup wizard will refresh Windows configuration.');
    }
    if (setup && setup.complete === true && process.platform === 'win32' && setup.mode === 'host' && setup.lan && setup.service) {
      const serviceState = getWindowsServiceState();
      let serviceHealthy = serviceState === 'running';
      if (serviceHealthy) {
        try {
          // NSSM can remain Running while repeatedly failing to start its child.
          // Confirm the actual ReportGen listener before trusting the service state.
          await waitForServer(`http://127.0.0.1:${serverPort}`, 4);
        } catch { serviceHealthy = false; }
      }
      if (serviceState === 'missing' || (serviceState === 'running' && !serviceHealthy)) {
        setup.complete = false;
        setup.serviceRepair = true;
        fs.writeFileSync(setupConfigPath, JSON.stringify(setup, null, 2));
        log(`The saved setup requires a healthy Windows service, but ReportGenServer is ${serviceState} and its application port is unavailable; reopening setup to repair it.`);
      }
    }
    const connection = readConnectionConfig();
    log(`Startup configuration: setupComplete=${!!(setup && setup.complete)} mode=${connection.mode} service=${!!(setup && setup.service)} lan=${!!(setup && setup.lan)} https=${!!(setup && setup.https)}`);
    if (!setup || setup.complete !== true) {
      closeSplashWindow();
      openSetupWizard();
      return;
    }
    try {
      if (connection.mode === 'remote') {
        await startRemote(connection.serverUrl);
      } else {
        await startLocal();
      }
    } catch (error) {
      log(`Startup failed: ${error.stack || error.message}`);
      closeSplashWindow();
      const detail = connection.mode === 'remote'
        ? `${error.message}\n\nChecked: ${connection.serverUrl}\nMake sure that server is running and reachable on the network, or switch back to "Run as local app" in Server Connection settings.\n\nStartup log: ${runtimeLog}`
        : `${error.message}\n\nStartup log: ${runtimeLog}`;
      const choice = await dialog.showMessageBox({
        type: 'error',
        title: 'ReportGen startup failed',
        message: connection.mode === 'remote' ? 'Could not connect to the ReportGen server.' : 'ReportGen failed to start.',
        detail,
        buttons: connection.mode === 'remote' ? ['Open Server Connection Settings', 'Quit'] : ['Quit'],
        defaultId: 0,
        cancelId: connection.mode === 'remote' ? 1 : 0
      });
      if (connection.mode === 'remote' && choice.response === 0) {
        openConnectionSettingsWindow();
      } else {
        app.quit();
      }
    }
  });
}

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
