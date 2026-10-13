$ErrorActionPreference = 'Stop'
Write-Host 'ReportGen LAN diagnostics' -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object InterfaceAlias,IPAddress,PrefixLength | Format-Table -AutoSize
Write-Host 'Test the displayed address from another device using http://<LAN-IP>:4310.'
