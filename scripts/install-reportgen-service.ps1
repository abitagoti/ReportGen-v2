<#
  Installs the standalone ReportGen server (server/server.js) as a real Windows
  service using NSSM, so it:
    - keeps running when everyone is logged out (no desktop session required)
    - starts automatically on boot, before anyone logs in
    - restarts itself automatically if the process ever crashes
    - is completely independent of the Electron desktop app - closing the
      desktop app on any machine (including this one) does not stop it

  This is the production path for "other machines open a browser to
  http://reportgen.local (or the LAN IP)". The scripts\start-lan*.ps1 scripts
  remain useful for foreground/manual testing, but for day-to-day use this
  service is what should actually be running.

  Requires NSSM (https://nssm.cc/) - either on PATH, or nssm.exe placed next
  to this script (scripts\nssm.exe), or pass -NssmPath explicitly.

  Usage (run as Administrator):
    .\install-reportgen-service.ps1                  # uses config\deployment.json if present
    .\install-reportgen-service.ps1 -Mode Http        # plain HTTP proxy on port 80, no TLS
    .\install-reportgen-service.ps1 -Mode Https       # HTTPS proxy, requires certificates already generated
    .\install-reportgen-service.ps1 -Mode Local       # loopback-only, no proxy (single machine, no LAN)
#>
param(
  [ValidateSet('Auto', 'Local', 'Http', 'Https')]
  [string]$Mode = 'Auto',
  [string]$NssmPath,
  [string]$ServiceName = 'ReportGenServer',
  [string]$ApplicationPort,
  [string]$HttpPort,
  [string]$HttpsPort,
  [string]$HostName,
  [string]$DataDir,
  [string]$NodePath,
  [string]$PfxPassword
)
$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from PowerShell as Administrator.'
}

$root = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $root 'server\server.js'
if (-not (Test-Path $serverScript)) { throw "server\server.js not found under $root" }

# --- Locate node.exe -------------------------------------------------------
$nodeCmd = if ($NodePath -and (Test-Path $NodePath)) { Get-Item $NodePath } else { $null }
if (-not $nodeCmd) { $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue }
if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCmd) { throw 'Node.js was not found on PATH. Install Node.js on this machine first (the service runs the same server.js that "npm run server" does).' }
$nodeExe = if ($NodePath -and (Test-Path $NodePath)) { (Resolve-Path $NodePath).Path } else { $nodeCmd.Source }

# --- Locate nssm.exe --------------------------------------------------------
function Resolve-Nssm {
  param([string]$Explicit)
  if ($Explicit) {
    if (Test-Path $Explicit) { return (Resolve-Path $Explicit).Path }
    throw "NSSM not found at -NssmPath '$Explicit'"
  }
  $onPath = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $bundled = Join-Path $PSScriptRoot 'nssm.exe'
  if (Test-Path $bundled) { return $bundled }
  # Download the official public-domain 64-bit helper when the user chooses
  # service installation in the Electron setup wizard. Windows 10+ needs this
  # pre-release line for reliable service startup.
  $toolDir = Join-Path $env:ProgramData 'ReportGen\tools'
  $installed = Join-Path $toolDir 'nssm.exe'
  if (Test-Path $installed) { return $installed }
  $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('reportgen-nssm-' + [guid]::NewGuid().ToString('N'))
  $archive = Join-Path $tempDir 'nssm.zip'
  try {
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri 'https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip' -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath $tempDir -Force
    $binary = Get-ChildItem -Path $tempDir -Filter 'nssm.exe' -Recurse -File | Where-Object { $_.FullName -match '[\\/]win64[\\/]nssm\.exe$' } | Select-Object -First 1
    if (-not $binary) { throw 'The official NSSM download did not contain its 64-bit service helper.' }
    New-Item -ItemType Directory -Force -Path $toolDir | Out-Null
    Copy-Item -LiteralPath $binary.FullName -Destination $installed -Force
    return $installed
  } catch {
    throw "Could not prepare the Windows service helper automatically. Check this computer's internet access, then retry. Details: $($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
$nssm = Resolve-Nssm -Explicit $NssmPath
Write-Host "Using nssm: $nssm" -ForegroundColor DarkGray
Write-Host "Using node: $nodeExe" -ForegroundColor DarkGray

function Invoke-Nssm {
  param([Parameter(Mandatory=$true)][string[]]$Arguments)
  & $nssm @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "NSSM command failed with exit code $($exitCode): nssm $($Arguments -join ' ')"
  }
}

# --- Work out which mode to install in -------------------------------------
$deploymentPath = if ($DataDir) { Join-Path $DataDir 'deployment.json' } else { Join-Path $root 'config\deployment.json' }
$deployment = $null
if (Test-Path $deploymentPath) { $deployment = Get-Content $deploymentPath -Raw | ConvertFrom-Json }

if ($Mode -eq 'Auto') {
  if ($deployment -and $deployment.httpsEnabled) { $Mode = 'Https' }
  elseif ($deployment) { $Mode = 'Http' }
  else { $Mode = 'Http' }
}

if (-not $ApplicationPort) { $ApplicationPort = if ($deployment) { [string]$deployment.applicationPort } else { '4310' } }
if (-not $HostName) { $HostName = if ($deployment) { $deployment.hostname } else { 'reportgen.local' } }
if (-not $HttpPort) { $HttpPort = if ($deployment) { [string]$deployment.httpPort } else { '80' } }
if (-not $HttpsPort) { $HttpsPort = if ($deployment) { [string]$deployment.httpsPort } else { '443' } }

$envPairs = @{
  REPORTGEN_PORT = $ApplicationPort
}
if ($DataDir) { $envPairs['REPORTGEN_DATA_DIR'] = $DataDir }
if ($NodePath) { $envPairs['ELECTRON_RUN_AS_NODE'] = '1' }

switch ($Mode) {
  'Local' {
    $envPairs['REPORTGEN_ALLOW_INSECURE_LAN'] = '0'
    $envPairs['REPORTGEN_HOST'] = '127.0.0.1'
    $envPairs['REPORTGEN_REVERSE_PROXY'] = '0'
  }
  'Http' {
    # Explicit legacy/trusted-LAN exception. HTTPS is the required production
    # LAN mode; this flag makes a deliberate -Mode Http choice auditable.
    $envPairs['REPORTGEN_ALLOW_INSECURE_LAN'] = '1'
    $envPairs['REPORTGEN_HOST'] = '0.0.0.0'
    $envPairs['REPORTGEN_REVERSE_PROXY'] = '1'
    $envPairs['REPORTGEN_HTTPS'] = '0'
    $envPairs['REPORTGEN_HTTP_PORT'] = $HttpPort
    $envPairs['REPORTGEN_LOCAL_HOSTNAME'] = $HostName
    if (-not $DataDir) { & (Join-Path $PSScriptRoot 'setup-windows-local-hostname.ps1') }
  }
  'Https' {
    $envPairs['REPORTGEN_ALLOW_INSECURE_LAN'] = '0'
    $certDir = if ($DataDir) { Join-Path $DataDir 'certificates' } else { Join-Path $root 'config\certificates' }
    $pfx = Join-Path $certDir 'reportgen-local-server.pfx'
    $credentialPath = Join-Path $certDir 'reportgen-local-pfx.credential'
    if (-not (Test-Path $pfx)) { throw "Server PFX missing at $pfx. Run scripts\generate-reportgen-certificates.ps1 first, or use -Mode Http." }
    if (-not $PfxPassword -and -not (Test-Path $credentialPath)) { throw "PFX password credential missing at $credentialPath. Run scripts\generate-reportgen-certificates.ps1 or create a new certificate in the setup wizard." }
    if ($PfxPassword) { $password = $PfxPassword }
    else {
      $stored = (Get-Content $credentialPath -Raw).Trim() | ConvertTo-SecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($stored)
      try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
    $envPairs['REPORTGEN_HOST'] = '0.0.0.0'
    $envPairs['REPORTGEN_REVERSE_PROXY'] = '1'
    $envPairs['REPORTGEN_HTTPS'] = '1'
    $envPairs['REPORTGEN_HTTP_PORT'] = $HttpPort
    $envPairs['REPORTGEN_HTTPS_PORT'] = $HttpsPort
    $envPairs['REPORTGEN_LOCAL_HOSTNAME'] = $HostName
    $envPairs['REPORTGEN_TLS_PFX'] = $pfx
    $envPairs['REPORTGEN_TLS_PFX_PASSWORD'] = $password
    if (-not $DataDir) { & (Join-Path $PSScriptRoot 'setup-windows-local-hostname.ps1') }
  }
}

# --- Install / reinstall the service ---------------------------------------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Service '$ServiceName' already exists - stopping and replacing it." -ForegroundColor Yellow
  if ($existing.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceName -Force
    $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  }
  Invoke-Nssm -Arguments @('remove', $ServiceName, 'confirm')
}

Invoke-Nssm -Arguments @('install', $ServiceName, $nodeExe)
# NSSM's `set AppParameters` command strips enclosing quotes from its value.
# Write the exact command-line argument directly while preserving NSSM's
# existing registry value kind so paths containing spaces remain one argument.
Invoke-Nssm -Arguments @('set', $ServiceName, 'AppParameters', $serverScript)
$serviceParametersKey = "SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
$registryKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($serviceParametersKey, $true)
if (-not $registryKey) { throw "Could not open the NSSM service parameters for '$ServiceName'." }
try {
  $appParametersKind = $registryKey.GetValueKind('AppParameters')
  $quotedServerScript = '"' + $serverScript + '"'
  $registryKey.SetValue('AppParameters', $quotedServerScript, $appParametersKind)
  $storedParameters = [string]$registryKey.GetValue('AppParameters', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
} finally { $registryKey.Dispose() }
if ($storedParameters -cne $quotedServerScript) {
  throw "The quoted ReportGen server path could not be stored for '$ServiceName'."
}
Invoke-Nssm -Arguments @('set', $ServiceName, 'AppDirectory', $root)
Invoke-Nssm -Arguments @('set', $ServiceName, 'DisplayName', 'ReportGen Server')
Invoke-Nssm -Arguments @('set', $ServiceName, 'Description', 'ReportGen application server (headless). Serves the ReportGen web UI and API for every machine on the LAN. Independent of the ReportGen desktop app.')
Invoke-Nssm -Arguments @('set', $ServiceName, 'Start', 'SERVICE_AUTO_START')
Invoke-Nssm -Arguments @('set', $ServiceName, 'AppExit', 'Default', 'Restart')
Invoke-Nssm -Arguments @('set', $ServiceName, 'AppRestartDelay', '3000')
Invoke-Nssm -Arguments @('set', $ServiceName, 'AppStdout', (Join-Path $root 'reportgen-service.log'))
Invoke-Nssm -Arguments @('set', $ServiceName, 'AppStderr', (Join-Path $root 'reportgen-service.log'))
Invoke-Nssm -Arguments @('set', $ServiceName, 'AppRotateFiles', '1')
Invoke-Nssm -Arguments @('set', $ServiceName, 'AppRotateOnline', '1')
Invoke-Nssm -Arguments @('set', $ServiceName, 'AppRotateBytes', '5242880')

$envArgs = @()
foreach ($key in $envPairs.Keys) { $envArgs += "$key=$($envPairs[$key])" }
Invoke-Nssm -Arguments (@('set', $ServiceName, 'AppEnvironmentExtra') + $envArgs)

Invoke-Nssm -Arguments @('start', $ServiceName)
$serviceDeadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  $serviceStatus = (Get-Service -Name $ServiceName -ErrorAction Stop).Status
} while ($serviceStatus -ne 'Running' -and (Get-Date) -lt $serviceDeadline)
if ($serviceStatus -ne 'Running') { throw "Windows created the ReportGen service, but it did not reach Running state (current state: $serviceStatus). Check reportgen-service.log under $root." }

function Test-TcpPort {
  param([string]$Address, [int]$Port)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $pending = $client.BeginConnect($Address, $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(1000)) { return $false }
    $client.EndConnect($pending)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

$applicationDeadline = (Get-Date).AddSeconds(30)
while (-not (Test-TcpPort -Address '127.0.0.1' -Port ([int]$ApplicationPort)) -and (Get-Date) -lt $applicationDeadline) {
  Start-Sleep -Milliseconds 500
}
if (-not (Test-TcpPort -Address '127.0.0.1' -Port ([int]$ApplicationPort))) {
  throw "The Windows service is running, but ReportGen did not open its application port $ApplicationPort. Check reportgen-service.log under $root."
}
if ($Mode -eq 'Https' -and -not (Test-TcpPort -Address '127.0.0.1' -Port ([int]$HttpsPort))) {
  throw "The Windows service started ReportGen, but HTTPS port $HttpsPort is not listening. Check reportgen-service.log under $root."
}
if ($Mode -eq 'Http' -and -not (Test-TcpPort -Address '127.0.0.1' -Port ([int]$HttpPort))) {
  throw "The Windows service started ReportGen, but HTTP port $HttpPort is not listening. Check reportgen-service.log under $root."
}

Write-Host ''
Write-Host "ReportGen server installed as a Windows service ('$ServiceName') in '$Mode' mode." -ForegroundColor Green
Write-Host 'It will now start automatically on boot and restart itself if it ever crashes -' -ForegroundColor Green
Write-Host 'no one needs to stay logged in, and closing the desktop app anywhere does not stop it.' -ForegroundColor Green
if ($Mode -ne 'Local') {
  $scheme = if ($Mode -eq 'Https') { 'https' } else { 'http' }
  Write-Host "Other computers on the LAN: open a browser to $scheme`://$HostName" -ForegroundColor Cyan
}
Write-Host "Service log: $(Join-Path $root 'reportgen-service.log')" -ForegroundColor DarkGray
Write-Host "Manage it with: nssm status $ServiceName | nssm stop $ServiceName | nssm restart $ServiceName" -ForegroundColor DarkGray
