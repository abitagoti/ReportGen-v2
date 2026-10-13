# ReportGen 2.0.11 service update and large-data improvements

## Build the Windows installer

On a Windows computer with Node.js 22.12 or newer:

1. Extract this project ZIP.
2. Open a terminal in the extracted project folder.
3. Run `npm ci`.
4. Run `npm run build:desktop`.
5. Find `ReportGen-Setup-2.0.11.exe` in the `release` folder. Run it over the existing ReportGen installation; the app-data folder and database remain in place during this update.

## Service updates and large datasets

When the setup wizard has installed the ReportGen background service, an installer update stops that service before replacing program files and starts it again after a successful update. If the installer is cancelled after stopping the service, it attempts to start the service again. Fresh setup still installs the service as Automatic and starts it from the wizard. If Windows blocks the service stop, the installer cancels safely and asks you to rerun it as administrator.

Sales records are retained; imports are not copied as separate files. Read `DATA-SIZE-AND-RETENTION.md` before planning automatic cleanup. The app does not delete imported sales history automatically.

## First launch

The Electron app opens the setup wizard the first time it runs. Choose local use, hosting on this computer, or connecting to an existing ReportGen server. Hosting can configure a `.local` name, Windows Firewall access, and HTTPS certificates. Windows shows its normal administrator approval prompt for network changes. The ReportGen root certificate is trusted for the current Windows account; each other device must install the public CA certificate downloaded from the server's secure connection page.

Setup and certificate data are saved under the current user's ReportGen app-data folder, so upgrades do not need to write into `Program Files`.

With the wizard's default HTTPS setup, open `https://reportgen.local` (no port number). The HTTP address `http://reportgen.local` redirects to it. Standard browser ports 80 and 443 are used; port `4310` is the private app port and is not the LAN browser address. Upgrading a host set up by the first wizard release (`:8080`/`:8443`) opens the wizard once to refresh the Windows firewall and service configuration. If setup previously saved the background-service choice but Windows does not have the service installed, the wizard opens again to repair it. The wizard verifies that the service is running before it reports setup complete. Keep the ReportGen desktop app open unless its Windows service was successfully installed. The Network & deployment panel displays the correct browser address for the active configuration.

The service installer writes the quoted server-script path directly into the NSSM service registry settings because NSSM's command-line setter removes the surrounding quotes. It then confirms that ReportGen's application port and configured browser port are listening. On startup, the desktop app also checks the actual local application port; a Windows service wrapper that is running while its ReportGen child is crashing opens setup again for repair. Startup details are written to `%APPDATA%\ReportGen-v2\desktop-startup.log`.

Sales imports let the user choose a worksheet in a multi-sheet workbook and show how many rows were imported or excluded. The consolidated report reloads the current business list and stops with a clear message if any business detail request fails, instead of silently treating missing data as zero. It also blocks date ranges longer than ten years so the existing monthly limit cannot produce a partial report.

If a prior build installed a broken service, install this update and open ReportGen. It will reopen setup to repair the service while retaining the hostname, HTTPS, and certificate settings. Finish the wizard, approve the Windows administrator prompt, and wait for its port checks to complete.

For an earlier build already stuck waiting for a missing service, close ReportGen and change only `"service": true` to `"service": false` in `%APPDATA%\ReportGen-v2\setup.json`, then reopen the app. This keeps the host, LAN, HTTPS, and certificate selections while letting the desktop app run the server itself.

## Windows service option

The background service installer uses NSSM. When selected in the wizard, it asks Windows for administrator approval and downloads the 64-bit helper from the official NSSM site if it is not already on the computer. This requires an internet connection. The official project describes NSSM as public domain and provides downloads at [nssm.cc](https://nssm.cc/download).

## Verify the project

Run `npm test` after installing dependencies with `npm ci`. The test suite requires the project's locked runtime packages.


On the login page, double-click the small download control in the lower-right corner to download the public CA certificate. Certificate downloads are served from the persistent app-data certificate folder created by the setup wizard.
