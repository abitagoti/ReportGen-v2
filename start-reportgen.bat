@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo ReportGen LAN HTTPS requires Administrator privileges.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
if not exist node_modules\better-sqlite3 call npm install
if not exist config\deployment.json (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-reportgen-deployment.ps1"
)
if not exist config\certificates\reportgen-local-server.pfx (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\generate-reportgen-certificates.ps1"
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows-local-hostname.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-lan-https.ps1"
pause
