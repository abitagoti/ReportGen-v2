param(
  [string]$ServiceName = 'ReportGenServer',
  [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = 'Stop'
$sc = Join-Path $env:SystemRoot 'System32\sc.exe'
$taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'

function Get-ReportGenServiceSnapshot {
  $output = (& $sc queryex $ServiceName 2>&1) -join "`n"
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    if ($output -match '\b1060\b|does not exist as an installed service') {
      return [pscustomobject]@{ State = 'MISSING'; ProcessId = 0; Output = $output }
    }
    throw "Could not query Windows service '$ServiceName' (code $exitCode): $output"
  }

  $stateMatch = [regex]::Match($output, '(?im)^\s*STATE\s*:\s*\d+\s+([A-Z_]+)')
  $pidMatch = [regex]::Match($output, '(?im)^\s*PID\s*:\s*(\d+)')
  if (-not $stateMatch.Success) { throw "Windows returned no service state for '$ServiceName': $output" }
  $processId = if ($pidMatch.Success) { [int]$pidMatch.Groups[1].Value } else { 0 }
  return [pscustomobject]@{ State = $stateMatch.Groups[1].Value; ProcessId = $processId; Output = $output }
}

function Stop-ReportGenProcessTree {
  param([int]$ProcessId)

  if ($ProcessId -le 0) { return $false }
  $output = & $taskkill /PID $ProcessId /T /F 2>&1
  return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join ' ') }
}

try {
  $service = Get-ReportGenServiceSnapshot
  if ($service.State -eq 'MISSING') {
    Write-Output "ReportGen service '$ServiceName' is not installed."
    exit 0
  }
  if ($service.State -eq 'STOPPED') {
    Write-Output 'ReportGen service is already stopped.'
    exit 0
  }

  $processId = [int]$service.ProcessId
  if ($processId -le 0) {
    throw "Windows reports service state '$($service.State)' but has no service process ID to terminate."
  }

  $killResult = Stop-ReportGenProcessTree -ProcessId $processId
  $killDetails = if ($killResult.ExitCode -eq 0) { 'Process tree terminated.' } else { "taskkill returned $($killResult.ExitCode): $($killResult.Output)" }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    $service = Get-ReportGenServiceSnapshot
    if ($service.State -eq 'MISSING' -or $service.State -eq 'STOPPED') {
      Write-Output "ReportGen service stopped. Terminated process tree $processId."
      exit 0
    }

    # A service wrapper can briefly be replaced while Windows is processing a
    # pending stop. Terminate the current PID too if Windows reports a new one.
    $currentProcessId = [int]$service.ProcessId
    if ($currentProcessId -gt 0 -and $currentProcessId -ne $processId) {
      $processId = $currentProcessId
      $killResult = Stop-ReportGenProcessTree -ProcessId $processId
      $killDetails = if ($killResult.ExitCode -eq 0) { 'Process tree terminated.' } else { "taskkill returned $($killResult.ExitCode): $($killResult.Output)" }
    }
  } while ((Get-Date) -lt $deadline)

  $service = Get-ReportGenServiceSnapshot
  throw "Windows still reports service state '$($service.State)' (process ID $($service.ProcessId)) after force stop. $killDetails"
} catch {
  [Console]::Out.WriteLine("Force stop failed: $($_.Exception.Message)")
  exit 1
}
