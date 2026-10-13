$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $root "config\deployment.json"
if (-not (Test-Path $profilePath)) { throw "Deployment profile missing. Run setup-reportgen-deployment.ps1 first." }
$profile = Get-Content $profilePath -Raw | ConvertFrom-Json
$secure = Read-Host "Enter PFX password (minimum 12 characters)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
& (Join-Path $PSScriptRoot "generate-local-certificates.ps1") -HostName $profile.hostname -PfxPassword $password
