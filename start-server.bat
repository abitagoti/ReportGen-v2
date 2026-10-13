@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo ReportGen Server + Web Client
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on this computer.
  pause
  exit /b 1
)

if not exist "node_modules\better-sqlite3" (
  echo Dependencies are not installed. Installing them now...
  call npm install
  if errorlevel 1 goto :fail
)

if not exist "node_modules\xlsx" (
  echo Sales-import (xlsx) dependency is missing. Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo.
echo Starting ReportGen server and browser client...
echo Keep this window open while using ReportGen.
echo.
echo Open ReportGen in your browser:
echo http://127.0.0.1:4310
 echo.
echo Health check: http://127.0.0.1:4310/api/health
echo.

call npm run server
if errorlevel 1 goto :fail
endlocal
exit /b 0

:fail
echo.
echo ReportGen server stopped because an error occurred.
pause
endlocal
exit /b 1
