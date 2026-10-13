$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $root "config\deployment.json"
$certDir = Join-Path $root "config\certificates"
$manifest = Join-Path $certDir "reportgen-local-certificate.json"
if (-not (Test-Path $profilePath)) { throw "Deployment profile missing. Run setup-reportgen-deployment.ps1 first." }
if (-not (Test-Path $manifest)) { throw "Certificates missing. Run generate-reportgen-certificates.ps1 first." }
$profile = Get-Content $profilePath -Raw | ConvertFrom-Json
$pfx = Join-Path $certDir "reportgen-local-server.pfx"
if (-not (Test-Path $pfx)) { throw "Server PFX missing." }
$credentialPath = Join-Path $certDir "reportgen-local-pfx.credential"
$password = $env:REPORTGEN_TLS_PFX_PASSWORD
if ([string]::IsNullOrWhiteSpace($password) -and (Test-Path $credentialPath)) {
  $stored = (Get-Content $credentialPath -Raw).Trim() | ConvertTo-SecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($stored)
  try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if ([string]::IsNullOrWhiteSpace($password)) {
  $secure = Read-Host "Enter PFX password (saved for this Windows user)" -AsSecureString
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  $secure | ConvertFrom-SecureString | Set-Content $credentialPath -Encoding UTF8 -Force
}
$env:REPORTGEN_REVERSE_PROXY = "1"
$env:REPORTGEN_HTTPS = "1"
# The app itself always binds to 127.0.0.1 when the reverse proxy is on; the proxy
# is what needs to bind to all interfaces to actually be reachable on the LAN.
# Set this explicitly here (rather than relying on config.js's default) since this
# script IS the deliberate opt-in into LAN exposure.
if (-not $env:REPORTGEN_HOST) { $env:REPORTGEN_HOST = "0.0.0.0" }
$env:REPORTGEN_HTTP_PORT = [string]$profile.httpPort
$env:REPORTGEN_HTTPS_PORT = [string]$profile.httpsPort
$env:REPORTGEN_LOCAL_HOSTNAME = $profile.hostname
$env:REPORTGEN_TLS_PFX = [IO.Path]::GetFullPath($pfx)
$env:REPORTGEN_TLS_PFX_PASSWORD = $password
$env:REPORTGEN_PORT = [string]$profile.applicationPort
Set-Location $root
Write-Host "Starting ReportGen at https://$($profile.hostname)"
Write-Host "Internal application: http://127.0.0.1:$($profile.applicationPort)"
npm run server
