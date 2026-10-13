# 2026-09-25 - LAN service + remote desktop client

## 1. Fixed: `start-reportgen-lan.ps1` never actually exposed port 80 on the LAN

`server/deployment/reverseProxy.js` binds its public-facing listener to
`REPORTGEN_HOST`, while `server/server.js` intentionally always binds the app
itself to `127.0.0.1` when the reverse proxy is on. `start-reportgen-lan.ps1`
was setting `REPORTGEN_HOST = '127.0.0.1'` with `REPORTGEN_REVERSE_PROXY = '1'`,
so the proxy - the thing meant to be reachable from other machines - ended up
loopback-only too. Firewall rules, the hosts-file entry, and hostname setup
were all correct; the listener itself was never exposed. Fixed to
`REPORTGEN_HOST = '0.0.0.0'`, matching `start-lan.ps1`, `start-lan-proxy.ps1`,
and `start-lan-https.ps1`, which already set this correctly.

The other three `start-lan*.ps1` scripts are still around for manual/foreground
testing; not consolidated yet.

## 2. Added: real Windows service for the standalone server

`scripts/install-reportgen-service.ps1` (+ matching `uninstall-reportgen-service.ps1`,
and root-level `install-reportgen-service.bat` / `uninstall-reportgen-service.bat`
wrappers) register `server/server.js` as a Windows service via NSSM:

- Starts automatically on boot, before anyone logs in.
- Auto-restarts on crash.
- Keeps running regardless of what the Electron desktop app is doing on any
  machine, including this one.
- Auto-detects mode (`Http` / `Https` / `Local`) from `config/deployment.json`
  when present, or takes `-Mode` explicitly.
- For HTTPS it reuses the certificate + saved PFX password from
  `scripts/generate-reportgen-certificates.ps1` / `start-lan-https.ps1`, since a
  background service has no console to prompt for a password on.

Requires NSSM (https://nssm.cc/) on PATH, at `scripts\nssm.exe`, or via
`-NssmPath`. Not bundled in this repo.

Other machines on the LAN: open a browser to `http://reportgen.local` (or
`https://reportgen.local` in HTTPS mode) - no desktop app install needed there.

## 3. Added: Electron "connect to an existing server" mode

Previously the desktop app could only spawn and use its own private, loopback-only
server (one person, one machine, own database) - by design, since
`electron-main.js` hardcoded `REPORTGEN_HOST: '127.0.0.1'` for the process it spawns.
That spawning behavior is unchanged and remains the default.

New: **ReportGen menu -> Server Connection…** lets someone instead point the
desktop app's window at a server already running elsewhere (e.g. the Windows
service from #2) without spawning a local server at all. The choice is saved
to `connection.json` in the app's data directory and applied on relaunch.
Useful for people who want a native window instead of a browser tab, without
each of them running their own local copy of the app and database.

Files added: `electron-connection-preload.js`, `electron-connection-settings.html`.
`electron-main.js` refactored so `waitForServer` / `createWindow` take a target
URL (loopback for local mode, the saved address for remote mode) instead of
always assuming loopback.
