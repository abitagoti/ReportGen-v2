$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:REPORTGEN_HOST = '0.0.0.0'
$env:REPORTGEN_PORT = if ($env:REPORTGEN_PORT) { $env:REPORTGEN_PORT } else { '4310' }
$env:REPORTGEN_REVERSE_PROXY = '0'
# Legacy plain-HTTP LAN mode. Production LAN deployments should use start-lan-https.ps1.
$env:REPORTGEN_ALLOW_INSECURE_LAN = '1'
Write-Host "Starting ReportGen for LAN access on port $env:REPORTGEN_PORT" -ForegroundColor Green
npm run server
