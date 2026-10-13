param([string]$HostName)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$configDir = Join-Path $root "config"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
if ([string]::IsNullOrWhiteSpace($HostName)) { $HostName = Read-Host "Enter ReportGen local hostname (example: reportgen.local)" }
$HostName = $HostName.Trim().ToLower()
if ($HostName -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$') { throw "Hostname must be a valid .local name, e.g. reportgen.local" }
$port = Read-Host "Internal application port [4310]"; if ([string]::IsNullOrWhiteSpace($port)) { $port = "4310" }
$profile = @{ hostname=$HostName; applicationPort=[int]$port; httpPort=80; httpsPort=443; reverseProxy=$true; httpsEnabled=$true; createdAt=(Get-Date).ToUniversalTime().ToString("o") }
$profile | ConvertTo-Json | Set-Content (Join-Path $configDir "deployment.json") -Encoding UTF8
Write-Host "Saved deployment profile: $HostName"
Write-Host "Now generate certificates with scripts\generate-reportgen-certificates.ps1"
