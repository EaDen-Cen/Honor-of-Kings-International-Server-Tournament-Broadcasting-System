@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title HOK BP Simulator Stop

echo ==========================================
echo   HOK BP Simulator - Stopping...
echo ==========================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-managed.ps1" -Target simulator
if errorlevel 1 (
  echo [ERROR] HOK simulator could not be stopped. See the error above.
  pause
  exit /b 1
)

timeout /t 1 /nobreak >nul
endlocal
exit /b 0
