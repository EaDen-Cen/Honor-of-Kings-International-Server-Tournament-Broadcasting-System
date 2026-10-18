@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title HOK BP Simulator Launcher

echo ==========================================
echo   HOK BP Simulator - Starting...
echo ==========================================
echo.

where node >nul 2>&1 || (echo [ERROR] Node.js was not found in PATH.& pause & exit /b 1)
where npm >nul 2>&1 || (echo [ERROR] npm was not found in PATH.& pause & exit /b 1)
if not exist "run-bp-simulator.ps1" (echo [ERROR] run-bp-simulator.ps1 is missing.& pause & exit /b 1)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-bp-simulator.ps1" -PrepareOnly
if errorlevel 1 (
  echo [ERROR] Simulator preparation failed.
  pause
  exit /b 1
)

if not exist "artifacts" mkdir "artifacts"

echo Starting or reusing simulator in the background...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-bp-simulator.ps1" -Background
if errorlevel 1 (
  echo [ERROR] Failed to start simulator.
  pause
  exit /b 1
)

set /a TRIES=0
:wait_simulator
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/tools/bp-simulator-control' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto simulator_ready
set /a TRIES+=1
if %TRIES% GEQ 30 goto simulator_failed
timeout /t 1 /nobreak >nul
goto wait_simulator

:simulator_failed
echo [ERROR] Simulator did not become ready after 30 checks.
echo Log: %~dp0artifacts\bp-simulator.log
pause
exit /b 1

:simulator_ready
start "" "http://127.0.0.1:5173/tools/bp-simulator-control"
echo.
echo Simulator is ready.
echo Control: http://127.0.0.1:5173/tools/bp-simulator-control
echo Stage:   http://127.0.0.1:5173/tools/bp-simulator
echo.
echo This launcher will close automatically.
echo Use stop-bp-simulator.bat when finished.
timeout /t 2 /nobreak >nul
endlocal
exit /b 0
