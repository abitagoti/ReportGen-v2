$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from PowerShell as Administrator.'
}
& (Join-Path $PSScriptRoot 'setup-windows-local-hostname.ps1')
# The app itself always binds to 127.0.0.1 when the reverse proxy is on (see
# server/server.js); the proxy is what needs to bind to all interfaces to
# actually be reachable on the LAN. This was previously left at 127.0.0.1,
# which made both the app and the proxy loopback-only and silently broke
# LAN/hostname access even with firewall and hosts-file setup done correctly.
$env:REPORTGEN_HOST = '0.0.0.0'
$env:REPORTGEN_PORT = if ($env:REPORTGEN_PORT) { $env:REPORTGEN_PORT } else { '4310' }
$env:REPORTGEN_REVERSE_PROXY = '1'
$env:REPORTGEN_HTTPS = '0'
# Legacy plain-HTTP LAN mode. Production LAN deployments should use HTTPS.
$env:REPORTGEN_ALLOW_INSECURE_LAN = '1'
$env:REPORTGEN_HTTP_PORT = if ($env:REPORTGEN_HTTP_PORT) { $env:REPORTGEN_HTTP_PORT } else { '80' }
$env:REPORTGEN_LOCAL_HOSTNAME = if ($env:REPORTGEN_LOCAL_HOSTNAME) { $env:REPORTGEN_LOCAL_HOSTNAME } else { 'reportgen.local' }
Write-Host "Public URL: http://$env:REPORTGEN_LOCAL_HOSTNAME" -ForegroundColor Cyan
Write-Host "Internal application: http://127.0.0.1:$env:REPORTGEN_PORT" -ForegroundColor DarkCyan
npm run server
