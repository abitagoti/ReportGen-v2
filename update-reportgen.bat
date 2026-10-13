@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo ReportGen Safe Update Helper
echo ========================================
echo.
echo This update helper does NOT install packages automatically.
echo Persistent database and user configuration live outside the application folder.
echo Close ReportGen before continuing.
echo.

if not exist "package.json" (
  echo ERROR: Run this file from the ReportGen application folder.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install the supported runtime before updating.
  pause
  exit /b 1
)

if not exist "node_modules\better-sqlite3" (
  echo ERROR: ReportGen dependencies are missing.
  echo This helper will not run npm install automatically.
  echo Repair/reinstall the ReportGen installation, then run this helper again.
  pause
  exit /b 1
)

if not exist "RELEASE-MANIFEST.json" (
  echo ERROR: Release integrity manifest is missing.
  echo Do not continue with an unverified application folder.
  pause
  exit /b 1
)

node scripts\verify-release-integrity.js
if errorlevel 1 goto :fail

if not exist "%APPDATA%\ReportGen\data" mkdir "%APPDATA%\ReportGen\data"

echo.
echo Release integrity verified.
echo Persistent data directory:
echo %APPDATA%\ReportGen\data
echo.
echo Starting ReportGen once so migrations and database recovery safeguards can run.
call npm run server
if errorlevel 1 goto :fail

endlocal
exit /b 0

:fail
echo.
echo ReportGen update/start was blocked or failed.
pause
endlocal
exit /b 1
