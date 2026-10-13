# Configures one-time Windows networking prerequisites for ReportGen LAN deployment.
# Must run elevated. It is safe to run repeatedly.
$ErrorActionPreference = 'Stop'
$hostname = if ($env:REPORTGEN_LOCAL_HOSTNAME) { $env:REPORTGEN_LOCAL_HOSTNAME } else { 'reportgen.local' }

$addresses = @(Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } |
  Sort-Object InterfaceMetric,IPAddress |
  Select-Object -ExpandProperty IPAddress)
if (-not $addresses.Count) { throw 'No usable LAN IPv4 address was found.' }

# Keep the host computer itself working even when Windows does not resolve .local via mDNS.
$hostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$raw = if (Test-Path $hostsPath) { Get-Content -Raw -Path $hostsPath } else { '' }
$escaped = [regex]::Escape($hostname)
$lines = @($raw -split "`r?`n" | Where-Object { $_ -notmatch "(?i)^\s*#?\s*\S+\s+$escaped(\s|$)" })
# Add every usable address so the host can use either active LAN interface.
foreach ($address in $addresses) {
  $lines += "$address`t$hostname"
}

# Set-Content can fail on the Windows hosts-file provider with
# 'Stream was not readable'. Use .NET file I/O instead.
$hostsText = (($lines | Where-Object { $_ -ne $null }) -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($hostsPath, $hostsText, [System.Text.Encoding]::ASCII)

# Required for HTTPS/HTTP and mDNS. Existing rules are reused where present.
$rules = @(
  @{ Name='ReportGen HTTP Proxy (TCP 80)'; Protocol='TCP'; Port=80 },
  @{ Name='ReportGen HTTPS Proxy (TCP 443)'; Protocol='TCP'; Port=443 },
  @{ Name='ReportGen mDNS (UDP 5353)'; Protocol='UDP'; Port=5353 }
)
foreach ($rule in $rules) {
  if (-not (Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow -Protocol $rule.Protocol -LocalPort $rule.Port -Profile Any | Out-Null
  }
}
Write-Host "ReportGen networking configured: $hostname -> $($addresses -join ', ')" -ForegroundColor Green
