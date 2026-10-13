<#
  Removes the Windows service installed by install-reportgen-service.ps1.
  Does not touch the ReportGen database or data directory - only the service
  registration itself.
#>
param(
  [string]$NssmPath,
  [string]$ServiceName = 'ReportGenServer'
)
$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from PowerShell as Administrator.'
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "No service named '$ServiceName' is installed." -ForegroundColor Yellow
  exit 0
}

function Resolve-Nssm {
  param([string]$Explicit)
  if ($Explicit) { if (Test-Path $Explicit) { return (Resolve-Path $Explicit).Path }; throw "NSSM not found at -NssmPath '$Explicit'" }
  $onPath = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $bundled = Join-Path $PSScriptRoot 'nssm.exe'
  if (Test-Path $bundled) { return $bundled }
  $managed = Join-Path $env:ProgramData 'ReportGen\tools\nssm.exe'
  if (Test-Path $managed) { return $managed }
  throw "nssm.exe was not found. Put it on PATH, at $bundled, or pass -NssmPath."
}
$nssm = Resolve-Nssm -Explicit $NssmPath

& $nssm stop $ServiceName | Out-Null
& $nssm remove $ServiceName confirm | Out-Null
Write-Host "Removed service '$ServiceName'. ReportGen's data and database were left untouched." -ForegroundColor Green
