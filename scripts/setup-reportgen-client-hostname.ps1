param(
  [Parameter(Mandatory=$true)][string]$ServerIp,
  [string]$HostName = 'reportgen.local'
)
$ErrorActionPreference='Stop'
$parsed = $null
if (-not [System.Net.IPAddress]::TryParse($ServerIp,[ref]$parsed) -or $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw "Invalid IPv4 address: $ServerIp" }
if ($HostName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.local$') { throw "Invalid .local hostname: $HostName" }
$hostsPath=Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$backup="$hostsPath.reportgen-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item -LiteralPath $hostsPath -Destination $backup -Force
$raw=if(Test-Path $hostsPath){Get-Content -Raw -Path $hostsPath}else{''}
$escaped=[regex]::Escape($HostName)
$lines=@($raw -split "`r?`n" | Where-Object { $_ -notmatch "(?i)^\s*#?\s*\S+\s+$escaped(\s|$)" })
$lines += "$ServerIp`t$HostName"
$text=(($lines | Where-Object {$_ -ne $null}) -join [Environment]::NewLine).TrimEnd()+[Environment]::NewLine
[System.IO.File]::WriteAllText($hostsPath,$text,[Text.Encoding]::ASCII)
Clear-DnsClientCache
Write-Host "Configured $HostName -> $ServerIp on this client." -ForegroundColor Green
Write-Host "Hosts backup: $backup" -ForegroundColor DarkGray
Write-Host "Test with: ping $HostName  and  nslookup $HostName" -ForegroundColor Yellow
