@echo off
setlocal EnableExtensions
title ReportGen 2.0 - Complete Removal

echo.
echo ============================================================
echo   ReportGen 2.0 - COMPLETE REMOVAL
echo ============================================================
echo.
echo This removes ONLY ReportGen 2.0 data and installation paths:
echo   %%APPDATA%%\ReportGen-v2
echo   This script's own folder ONLY when the v97 marker is present
echo.
echo It does NOT target other ReportGen versions, generic Electron,
echo or the shared %%APPDATA%%\ReportGen directory.
echo.
echo WARNING: The selected ReportGen 2.0 database and backups
echo will be permanently deleted.
echo.
choice /C YN /N /M "Continue? [Y/N]: "
if errorlevel 2 exit /b 0

echo.
echo Stopping only ReportGen.exe...
taskkill /F /IM ReportGen.exe >nul 2>&1

set "SCRIPT_DIR=%~dp0"

echo Removing version-specific data...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$paths=@($env:APPDATA+'\ReportGen-v2',$env:LOCALAPPDATA+'\Programs\ReportGen-v2'); foreach($p in $paths){if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop}}"

echo Removing this folder only when the v97 marker is present...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$dir=[IO.Path]::GetFullPath($env:SCRIPT_DIR); $marker=Join-Path $dir 'REPORTGEN_V2_INSTALL.marker'; if(Test-Path -LiteralPath $marker){ $cmd='Start-Sleep -Milliseconds 800; Remove-Item -LiteralPath '''+$dir+''' -Recurse -Force -ErrorAction SilentlyContinue'; Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',$cmd }"

echo.
echo ReportGen 2.0 removal has been scheduled.
echo Other ReportGen versions were not targeted.
pause
exit /b 0
