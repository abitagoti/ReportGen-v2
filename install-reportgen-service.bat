@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Installing the ReportGen service requires Administrator privileges.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo ========================================
echo ReportGen - Install background service
echo ========================================
echo.
echo This installs ReportGen as a Windows service that keeps running
echo after you close this window, after you log out, and after a reboot.
echo It uses config\deployment.json if present (Mode=Auto). Pass a mode
echo explicitly by running scripts\install-reportgen-service.ps1 directly,
echo e.g.:  powershell -File scripts\install-reportgen-service.ps1 -Mode Http
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-reportgen-service.ps1"
pause
