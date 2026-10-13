param(
  [int]$ApplicationPort = 4312,
  [int]$HttpPort = 8080,
  [int]$HttpsPort = 8443,
  [string]$HostName = 'reportgen.local',
  [switch]$NoMdns,            # do not advertise the name on the LAN via mDNS
  [switch]$SkipSystemSetup    # do not touch the hosts file / Windows Firewall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# This launcher is deliberately isolated from the production deployment profile.
# It must never bind to the production ports 4310/80/443 or use the production DB.
if ($ApplicationPort -eq 4310 -or $HttpPort -eq 80 -or $HttpsPort -eq 443) {
  throw 'Development HTTPS launcher refuses production ports (4310/80/443).'
}
foreach ($item in @(@{n='ApplicationPort';v=$ApplicationPort},@{n='HttpPort';v=$HttpPort},@{n='HttpsPort';v=$HttpsPort})) {
  if ($item.v -lt 1 -or $item.v -gt 65535) { throw "$($item.n) must be a valid TCP port." }
}
if ($ApplicationPort -eq $HttpPort -or $ApplicationPort -eq $HttpsPort -or $HttpPort -eq $HttpsPort) {
  throw 'Development application, HTTP and HTTPS ports must be different.'
}

$HostName = $HostName.Trim().ToLower()
if ($HostName -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$') { throw 'HostName must be a valid .local name such as reportgen.local.' }

$lanAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } |
  Sort-Object InterfaceMetric,IPAddress |
  Select-Object -ExpandProperty IPAddress -Unique)
if (-not $lanAddresses.Count) { throw 'No usable LAN IPv4 address was found.' }

# ---------------------------------------------------------------------------
# Name resolution + firewall for the development ports.
# The server only accepts requests whose Host header is the configured name
# (that policy is intentional and is NOT relaxed here), so this PC must be able
# to resolve the name and Windows Firewall must allow the dev ports.
# Only the missing pieces are changed, and Windows asks for approval (UAC) once.
# ---------------------------------------------------------------------------
function Get-HostsMappings {
  param([string]$Name)
  $hostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
  $pattern = '^\s*([^#\s]+)\s+(?:\S+\s+)*' + [regex]::Escape($Name) + '(?:\s|$)'
  $mapped = @()
  foreach ($line in @(Get-Content -LiteralPath $hostsPath -ErrorAction SilentlyContinue)) {
    $m = [regex]::Match([string]$line, $pattern, 'IgnoreCase')
    if ($m.Success) { $mapped += $m.Groups[1].Value }
  }
  return $mapped
}
function Test-HostsMappingOk {
  param([string]$Name)
  $local = @('127.0.0.1', '::1') + @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress)
  $mapped = @(Get-HostsMappings -Name $Name)
  # OK only if the name is mapped and every mapping points at this PC.
  # A stale LAN address (e.g. after a DHCP change) counts as broken.
  return ($mapped.Count -gt 0 -and @($mapped | Where-Object { $local -notcontains $_ }).Count -eq 0)
}

if (-not $SkipSystemSetup) {
  $fixHosts = -not (Test-HostsMappingOk -Name $HostName)
  $missingRules = @(@($HttpPort, $HttpsPort) | Where-Object { -not (Get-NetFirewallRule -DisplayName "ReportGen DEV TCP $_" -ErrorAction SilentlyContinue) })
  $mdnsRuleMissing = (-not $NoMdns) -and (-not (Get-NetFirewallRule -DisplayName 'ReportGen DEV UDP 5353 mDNS' -ErrorAction SilentlyContinue))
  if ($fixHosts -or $missingRules.Count -or $mdnsRuleMissing) {
    $changes = @()
    if ($fixHosts) { $changes += "map $HostName to this PC in the Windows hosts file" }
    if ($missingRules.Count) { $changes += "allow TCP $($missingRules -join ', ') through Windows Firewall (local subnet only)" }
    if ($mdnsRuleMissing) { $changes += 'allow UDP 5353 (mDNS name lookups) through Windows Firewall (local subnet only)' }
    Write-Host ('Windows setup needed: ' + ($changes -join '; ') + '.') -ForegroundColor Yellow

    $elevatedScript = @'
$ErrorActionPreference = 'Stop'
$name = '__HOST__'
$hostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
if (__FIXHOSTS__) {
  Copy-Item -LiteralPath $hostsPath -Destination ($hostsPath + '.reportgen-backup-' + (Get-Date -Format yyyyMMdd-HHmmss)) -Force
  $pattern = '^\s*[^#\s]+\s+(?:\S+\s+)*' + [regex]::Escape($name) + '(?:\s|$)'
  $kept = @(Get-Content -LiteralPath $hostsPath | Where-Object { $_ -notmatch $pattern })
  $kept += "127.0.0.1`t$name"
  [IO.File]::WriteAllText($hostsPath, (($kept -join [Environment]::NewLine) + [Environment]::NewLine), [Text.Encoding]::ASCII)
  ipconfig /flushdns | Out-Null
}
foreach ($port in @(__PORTS__)) {
  $ruleName = "ReportGen DEV TCP $port"
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Enabled True -Protocol TCP -LocalPort $port -Profile Any -RemoteAddress LocalSubnet | Out-Null
  }
}
if (__MDNS__) {
  $mdnsRule = 'ReportGen DEV UDP 5353 mDNS'
  if (-not (Get-NetFirewallRule -DisplayName $mdnsRule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $mdnsRule -Direction Inbound -Action Allow -Enabled True -Protocol UDP -LocalPort 5353 -Profile Any -RemoteAddress LocalSubnet | Out-Null
  }
}
'@
    $elevatedScript = $elevatedScript.Replace('__HOST__', $HostName).Replace('__FIXHOSTS__', $(if ($fixHosts) { '$true' } else { '$false' })).Replace('__PORTS__', "$HttpPort,$HttpsPort").Replace('__MDNS__', $(if ($NoMdns) { '$false' } else { '$true' }))
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    try {
      if ($isAdmin) {
        & ([scriptblock]::Create($elevatedScript))
      } else {
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($elevatedScript))
        $proc = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded)
        if ($proc.ExitCode -ne 0) { throw "elevated setup exited with code $($proc.ExitCode)" }
      }
      Write-Host 'Windows setup applied.' -ForegroundColor Green
    } catch {
      Write-Host "WARNING: Windows setup was not applied ($($_.Exception.Message)). The server will still start, but $HostName may not resolve and other devices may be blocked by the firewall." -ForegroundColor Red
    }
  }
}
$nameResolvesLocally = Test-HostsMappingOk -Name $HostName

# Windows creates a Block rule for node.exe when its first-run firewall prompt is
# dismissed. Block rules override Allow rules, so other devices stay locked out
# no matter what rules this script adds. Detect and report (never auto-delete).
$nodeBlocks = @()
try {
  $nodeBlocks = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -like '*\node.exe' } | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' })
} catch { }
if ($nodeBlocks.Count) {
  Write-Host 'WARNING: Windows Firewall has inbound BLOCK rule(s) for node.exe. Block rules override Allow rules, so other devices cannot connect.' -ForegroundColor Red
  Write-Host 'Remove them from an Administrator PowerShell, then restart this launcher:' -ForegroundColor Red
  foreach ($rule in $nodeBlocks) { Write-Host "  Remove-NetFirewallRule -Name '$($rule.Name)'    # $($rule.DisplayName), $($rule.Profile)" -ForegroundColor Red }
}

$devRoot = Join-Path $env:TEMP 'ReportGen-Stage4-Dev'
$certDir = Join-Path $devRoot 'certificates'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

# Use the existing development database directly. This keeps accounts, roles,
# permissions and other development changes across restarts while remaining
# completely separate from the production deployment database.
$sourceDataCandidates = @(
  (Join-Path (Split-Path $root -Parent) 'reportgen-test-data'),
  (Join-Path $root 'reportgen-test-data')
)
$sourceDataDir = $sourceDataCandidates | Where-Object { Test-Path (Join-Path $_ 'reportgen.sqlite') } | Select-Object -First 1
if (-not $sourceDataDir) {
  throw 'Existing development database was not found. Expected ..\reportgen-test-data\reportgen.sqlite. Production data is never used by this launcher.'
}
$dataDir = [IO.Path]::GetFullPath($sourceDataDir)

# If a previous copy of this same development server is still listening, stop
# only processes whose command line points at this exact source tree. This avoids
# accidentally attaching the browser to an older Stage 4 build on :8443.
$devRootFull = [IO.Path]::GetFullPath($root).TrimEnd('\')
$portsToClean = @($ApplicationPort,$HttpPort,$HttpsPort) | Select-Object -Unique
foreach ($portToClean in $portsToClean) {
  $connections = @(Get-NetTCPConnection -LocalPort $portToClean -State Listen -ErrorAction SilentlyContinue)
  foreach ($connection in $connections) {
    $ownerPid = [int]$connection.OwningProcess
    if ($ownerPid -le 0) { continue }
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue
    $commandLine = [string]$processInfo.CommandLine
    if ($commandLine -and $commandLine -like "*$devRootFull*") {
      Write-Host "Stopping previous ReportGen development server process $ownerPid on port $portToClean..." -ForegroundColor Yellow
      Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
    } elseif ($connections.Count -gt 0) {
      throw "Port $portToClean is already in use by another process. The development launcher will not terminate an unrelated process."
    }
  }
}

$caPath = Join-Path $certDir 'reportgen-stage3-dev-ca.cer'
$pfxPath = Join-Path $certDir 'reportgen-stage3-dev-server.pfx'

# Generate a development-only CA and server certificate. The server certificate
# contains localhost, reportgen.local and the active LAN IPv4 addresses so the
# browser can test HTTPS without touching the production certificate/key.
$caSubject = 'CN=ReportGen Stage3 Development CA'
$existingCa = Get-ChildItem 'Cert:\CurrentUser\My' -ErrorAction SilentlyContinue |
  Where-Object { $_.Subject -eq $caSubject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
  Sort-Object NotAfter -Descending | Select-Object -First 1
if ($existingCa) {
  $ca = $existingCa
} else {
  $ca = New-SelfSignedCertificate -Type Custom -Subject $caSubject -FriendlyName 'ReportGen Stage3 Development CA' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage CertSign,CRLSign,DigitalSignature -NotAfter (Get-Date).AddYears(2) -TextExtension @('2.5.29.19={text}CA=true&pathlength=1')
}

$sanEntries = @('DNS=localhost',"DNS=$HostName") + @($lanAddresses | ForEach-Object { "IPAddress=$($_)" })
$server = New-SelfSignedCertificate -Type Custom -Subject 'CN=ReportGen Stage3 Development Server' -FriendlyName 'ReportGen Stage3 Development HTTPS' -Signer $ca -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(30) -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @("2.5.29.17={text}$($sanEntries -join '&')")

Export-Certificate -Cert $ca -FilePath $caPath -Force | Out-Null
Import-Certificate -FilePath $caPath -CertStoreLocation 'Cert:\CurrentUser\Root' -ErrorAction SilentlyContinue | Out-Null

$random = New-Object byte[] 24
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$pfxPassword = [Convert]::ToBase64String($random).Replace('+','A').Replace('/','B').Replace('=','C')
$securePassword = ConvertTo-SecureString -String $pfxPassword -AsPlainText -Force
Export-PfxCertificate -Cert $server -FilePath $pfxPath -Password $securePassword -Force | Out-Null

$env:REPORTGEN_PORT = [string]$ApplicationPort
$env:REPORTGEN_HOST = '0.0.0.0'
$env:REPORTGEN_REVERSE_PROXY = '1'
$env:REPORTGEN_HTTPS = '1'
$env:REPORTGEN_ALLOW_INSECURE_LAN = '0'
$env:REPORTGEN_HTTP_PORT = [string]$HttpPort
$env:REPORTGEN_HTTPS_PORT = [string]$HttpsPort
$env:REPORTGEN_LOCAL_HOSTNAME = $HostName
$env:REPORTGEN_TLS_PFX = [IO.Path]::GetFullPath($pfxPath)
$env:REPORTGEN_TLS_PFX_PASSWORD = $pfxPassword
$env:REPORTGEN_DATA_DIR = $dataDir
$env:REPORTGEN_MDNS = $(if ($NoMdns) { '0' } else { '1' })

Set-Location $root
Write-Host ''
Write-Host 'ReportGen Stage 4 DEVELOPMENT HTTPS' -ForegroundColor Cyan
Write-Host "Internal application: http://127.0.0.1:$ApplicationPort" -ForegroundColor Gray
Write-Host "Open this PC:         https://$($HostName):$HttpsPort" -ForegroundColor Green
Write-Host "HTTP redirect:        http://$($HostName):$HttpPort  (redirects to HTTPS)" -ForegroundColor Green
Write-Host "Other devices:        https://$($HostName):$HttpsPort  (must resolve $HostName to $($lanAddresses[0]) and trust the CA below)" -ForegroundColor Green
Write-Host "CA to trust on clients: $caPath" -ForegroundColor Gray
Write-Host "NOTE: addresses like https://$($lanAddresses[0]):$HttpsPort are rejected on purpose (Host-header policy). Always use $HostName." -ForegroundColor DarkYellow
if (-not $nameResolvesLocally) { Write-Host "WARNING: $HostName is not mapped to this PC in the hosts file; it will rely on mDNS only." -ForegroundColor Red }
Write-Host "mDNS advertising:     $(if ($NoMdns) { 'off' } else { 'on (UDP 5353)' })" -ForegroundColor Gray
Write-Host "Persistent development data: $dataDir" -ForegroundColor Gray
Write-Host "Server log: $(Join-Path $dataDir 'logs\reportgen-server.log')" -ForegroundColor Gray
Write-Host "Production ports 4310/80/443 and production data are not used by this launcher." -ForegroundColor Magenta
Write-Host ''

# Background self-test: prints whether the name resolves, the Host-header policy
# behaves as designed, and this PC trusts the dev CA. Runs in-process so its
# output appears in this console once the server is up.
$selfTestCode = @'
param($Name, $HttpsPort, $HttpPort, $MdnsOn)
function Say($text, $color) { $old = [Console]::ForegroundColor; if ($color) { [Console]::ForegroundColor = $color }; [Console]::WriteLine($text); [Console]::ForegroundColor = $old }
try {
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) {
    Start-Sleep -Seconds 1
    $code = (& curl.exe -k -s -o NUL -w '%{http_code}' --max-time 3 --resolve "${Name}:${HttpsPort}:127.0.0.1" "https://${Name}:${HttpsPort}/api/health" 2>$null)
    if ($code -eq '200') { $up = $true }
  }
  if (-not $up) { Say "[self-test] FAIL: https://${Name}:${HttpsPort}/api/health did not answer 200 within 60s. Check the server log." 'Red'; return }
  Say "[self-test] OK: HTTPS proxy answers for host name ${Name}." 'Green'
  $ipCode = (& curl.exe -k -s -o NUL -w '%{http_code}' --max-time 3 "https://127.0.0.1:${HttpsPort}/api/health" 2>$null)
  if ($ipCode -eq '400') { Say '[self-test] OK: IP-address Host header is rejected (400) - policy intact.' 'Green' } else { Say "[self-test] UNEXPECTED: IP Host header returned $ipCode (expected 400)." 'Red' }
  $redirect = (& curl.exe -s -o NUL -w '%{http_code}' --max-time 3 --resolve "${Name}:${HttpPort}:127.0.0.1" "http://${Name}:${HttpPort}/" 2>$null)
  if ($redirect -eq '301') { Say '[self-test] OK: HTTP redirects to HTTPS (301).' 'Green' } else { Say "[self-test] UNEXPECTED: HTTP returned $redirect (expected 301)." 'Red' }
  & curl.exe -s -o NUL --max-time 3 --ssl-no-revoke --resolve "${Name}:${HttpsPort}:127.0.0.1" "https://${Name}:${HttpsPort}/api/health" 2>$null
  if ($LASTEXITCODE -eq 0) { Say '[self-test] OK: this PC trusts the development CA.' 'Green' } else { Say "[self-test] This PC does not trust the development CA (curl exit $LASTEXITCODE). Import the CA file shown above." 'Yellow' }
  if ($MdnsOn) {
    try {
      $bytes = New-Object System.Collections.Generic.List[byte]
      foreach ($b in @(0x12,0x34,0,0,0,1,0,0,0,0,0,0)) { $bytes.Add([byte]$b) }
      foreach ($label in $Name.Split('.')) { $lb = [Text.Encoding]::ASCII.GetBytes($label); $bytes.Add([byte]$lb.Length); foreach ($x in $lb) { $bytes.Add([byte]$x) } }
      foreach ($b in @(0,0,1,0,1)) { $bytes.Add([byte]$b) }
      $udp = New-Object System.Net.Sockets.UdpClient(0)
      try {
        $udp.Client.ReceiveTimeout = 3000
        [void]$udp.Send($bytes.ToArray(), $bytes.Count, '224.0.0.251', 5353)
        $ep = New-Object System.Net.IPEndPoint([Net.IPAddress]::Any, 0)
        $resp = $udp.Receive([ref]$ep)
        Say "[self-test] OK: mDNS responder answered a multicast query for ${Name} -> $($resp[$resp.Length-4]).$($resp[$resp.Length-3]).$($resp[$resp.Length-2]).$($resp[$resp.Length-1])" 'Green'
      } finally { $udp.Close() }
    } catch { Say '[self-test] mDNS self-query got no answer. Other devices may not be able to resolve the name; check the firewall warnings above or add a hosts entry on the client.' 'Yellow' }
  }
  try {
    $resolved = [Net.Dns]::GetHostAddresses($Name) | ForEach-Object { $_.IPAddressToString }
    Say "[self-test] ${Name} resolves on this PC to: $($resolved -join ', ')" 'Gray'
  } catch { Say "[self-test] WARNING: ${Name} does not resolve on this PC." 'Red' }
} catch { Say "[self-test] could not run: $($_.Exception.Message)" 'Yellow' }
'@
$selfTest = [powershell]::Create()
[void]$selfTest.AddScript($selfTestCode).AddArgument($HostName).AddArgument($HttpsPort).AddArgument($HttpPort).AddArgument([bool](-not $NoMdns))
[void]$selfTest.BeginInvoke()

npm run server
