param(
  [Parameter(Mandatory=$true)][string]$HostName,
  [int]$HttpPort = 80,
  [int]$HttpsPort = 443
)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Windows needs administrator approval to allow ReportGen through the firewall and update the local host name.'
}
if ($HostName -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$') { throw 'Use a valid local name such as reportgen.local.' }
$addresses = @(Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } |
  Sort-Object InterfaceMetric, IPAddress | Select-Object -ExpandProperty IPAddress -Unique)
if (-not $addresses.Count) { throw 'No active local network address was found. Connect this computer to your network and try again.' }
$hostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$raw = if (Test-Path $hostsPath) { Get-Content -Raw -Path $hostsPath } else { '' }
$escaped = [regex]::Escape($HostName)
$lines = @($raw -split "`r?`n" | Where-Object { $_ -notmatch "(?i)^\s*#?\s*\S+\s+$escaped(\s|$)" })
foreach ($address in $addresses) { $lines += "$address`t$HostName" }
[IO.File]::WriteAllText($hostsPath, (($lines -join [Environment]::NewLine) + [Environment]::NewLine), [Text.Encoding]::ASCII)
function Ensure-LanFirewallRule {
  param([string]$Name, [string]$Protocol, [string]$Port)
  $rule = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($rule) {
    $rule | Set-NetFirewallRule -Enabled True -Profile Any | Out-Null
    $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet | Out-Null
  } else {
    New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Enabled True -Protocol $Protocol -LocalPort $Port -Profile Any -RemoteAddress LocalSubnet | Out-Null
  }
}
# Remove the nonstandard ports created by the first desktop wizard release
# when migrating to ordinary browser addresses. Those old firewall openings
# are no longer needed after the service is refreshed.
if ($HttpPort -eq 80) { Remove-NetFirewallRule -DisplayName 'ReportGen LAN TCP 8080' -ErrorAction SilentlyContinue }
if ($HttpsPort -eq 443) { Remove-NetFirewallRule -DisplayName 'ReportGen LAN TCP 8443' -ErrorAction SilentlyContinue }
foreach ($port in @($HttpPort, $HttpsPort) | Select-Object -Unique) {
  Ensure-LanFirewallRule -Name "ReportGen LAN TCP $port" -Protocol TCP -Port $port
}
Ensure-LanFirewallRule -Name 'ReportGen mDNS (UDP 5353)' -Protocol UDP -Port 5353
Write-Output "Network access enabled for $HostName on TCP ports $HttpPort and $HttpsPort, and LAN hostname discovery on UDP 5353."
