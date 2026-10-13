$ErrorActionPreference = 'Stop'
$ports = @(80, 4310)
foreach ($port in $ports) {
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($listeners) {
    Write-Host "Port $port is in use:" -ForegroundColor Yellow
    $listeners | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table
    foreach ($listener in $listeners) {
      try { Get-Process -Id $listener.OwningProcess | Select-Object Id, ProcessName } catch {}
    }
  } else {
    Write-Host "Port $port is available." -ForegroundColor Green
  }
}
