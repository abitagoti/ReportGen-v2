$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# This script uses the standard HTTP port (80) as the public entry point
# and forwards requests to the internal ReportGen application on port 4310.
# Run PowerShell as Administrator because binding port 80 may require elevation.
$env:REPORTGEN_HOST = '0.0.0.0'
$env:REPORTGEN_PORT = if ($env:REPORTGEN_PORT) { $env:REPORTGEN_PORT } else { '4310' }
$env:REPORTGEN_REVERSE_PROXY = '1'
$env:REPORTGEN_HTTPS = '0'
$env:REPORTGEN_HTTP_PORT = if ($env:REPORTGEN_HTTP_PORT) { $env:REPORTGEN_HTTP_PORT } else { '80' }
$env:REPORTGEN_LOCAL_HOSTNAME = if ($env:REPORTGEN_LOCAL_HOSTNAME) { $env:REPORTGEN_LOCAL_HOSTNAME } else { 'reportgen.local' }

Write-Host "Starting ReportGen with HTTP reverse proxy" -ForegroundColor Green
Write-Host "Public URL: http://$env:REPORTGEN_LOCAL_HOSTNAME" -ForegroundColor Cyan
Write-Host "Internal application: http://127.0.0.1:$env:REPORTGEN_PORT" -ForegroundColor DarkCyan
Write-Host "The hostname must resolve separately through mDNS, DNS, or the Windows hosts file." -ForegroundColor Yellow
npm run server
