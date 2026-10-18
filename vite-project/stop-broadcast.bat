@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title HOK Broadcast Stop

echo ==========================================
echo   HOK Broadcast - Stopping...
echo ==========================================
echo.

echo Stopping this project's server and Cloudflare tunnel...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-managed.ps1" -Target broadcast
if errorlevel 1 (
  echo [ERROR] Some HOK processes could not be stopped. See the error above.
  pause
  exit /b 1
)

echo.
echo HOK launcher processes stopped.
timeout /t 2 /nobreak >nul
endlocal
