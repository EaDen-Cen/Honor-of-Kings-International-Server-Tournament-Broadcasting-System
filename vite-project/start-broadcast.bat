@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if "%~1"=="--managed-session" goto managed_session
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher-session.ps1"
exit /b %errorlevel%
:managed_session
title HOK Broadcast Launcher

echo ==========================================
echo   HOK Broadcast - Starting...
echo ==========================================
echo.

where node >nul 2>&1 || (echo [ERROR] Node.js was not found in PATH.& pause & exit /b 1)
where npm >nul 2>&1 || (echo [ERROR] npm was not found in PATH.& pause & exit /b 1)
where cloudflared >nul 2>&1 || (echo [ERROR] cloudflared was not found in PATH.& pause & exit /b 1)
if not exist "package.json" (echo [ERROR] Launcher must stay in vite-project.& pause & exit /b 1)
if not exist "run-cloudflare.ps1" (echo [ERROR] run-cloudflare.ps1 is missing. Run git pull again.& pause & exit /b 1)
if not exist "run-server.ps1" (echo [ERROR] run-server.ps1 is missing. Extract the complete update package.& pause & exit /b 1)
if not exist "scripts\managed-process.ps1" (echo [ERROR] scripts\managed-process.ps1 is missing. Extract the complete update package.& pause & exit /b 1)

echo Preparing dependencies and web pages...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-server.ps1" -PrepareOnly
if errorlevel 1 (
  echo [ERROR] Preparation failed. See the error above.
  pause
  exit /b 1
)

if not exist "artifacts" mkdir "artifacts"
echo [1/4] Starting or reusing HOK server...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-server.ps1" -Background
if errorlevel 1 (
  echo [ERROR] Server startup failed. Check the error above; other applications were not stopped.
  pause
  exit /b 1
)
echo       Waiting for local server...
set /a SERVER_TRIES=0
:wait_server
powershell -NoProfile -Command "try { $h=Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2; if(-not $h.ok){exit 1}; Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/control' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto server_ready
set /a SERVER_TRIES+=1
if %SERVER_TRIES% GEQ 30 goto server_failed
timeout /t 1 /nobreak >nul
goto wait_server

:server_failed
echo [ERROR] Server did not become ready after 30 checks.
echo Server error log:
if exist "artifacts\server.log" type "artifacts\server.log"
echo Full log: %~dp0artifacts\server.log
pause
exit /b 1

:server_ready
echo       Server is ready.
echo [2/4] Starting or reusing Cloudflare Quick Tunnel...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-cloudflare.ps1" -Background
if errorlevel 1 (
  echo [ERROR] Tunnel startup failed. Check the error above.
  pause
  exit /b 1
)

echo [3/4] Waiting for public URL and optional Sites auto-sync...
set /a TUNNEL_TRIES=0
:wait_tunnel
set "PUBLIC_URL="
for /f "delims=" %%U in ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File run-cloudflare.ps1 -GetUrl 2^>nul') do set "PUBLIC_URL=%%U"
if defined PUBLIC_URL goto tunnel_ready
set /a TUNNEL_TRIES+=1
if %TUNNEL_TRIES% GEQ 60 goto tunnel_failed
timeout /t 1 /nobreak >nul
goto wait_tunnel

:tunnel_failed
echo [ERROR] No active tunnel URL was found after 60 checks.
echo.
if exist "artifacts\cloudflared.log" (
  echo Cloudflare log:
  type "artifacts\cloudflared.log"
) else (
  echo [ERROR] cloudflared.log was not created.
  echo         Check cloudflared installation and network access.
)
pause
exit /b 1

:tunnel_ready
> "artifacts\current-public-url.txt" echo %PUBLIC_URL%
>>"artifacts\current-public-url.txt" echo %PUBLIC_URL%/control
>>"artifacts\current-public-url.txt" echo %PUBLIC_URL%/caster
>>"artifacts\current-public-url.txt" echo %PUBLIC_URL%/overlay/draft

echo [4/4] Opening local Director window...
if exist "open-director.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-director.ps1" -Url "http://127.0.0.1:3001/control"
) else (
  start "" "http://127.0.0.1:3001/control"
)
echo.
echo ==========================================
echo   HOK Broadcast is READY
echo ==========================================
echo Local Control:
echo   http://127.0.0.1:3001/control
echo.
echo Public:
echo   %PUBLIC_URL%
echo.
echo Caster:
echo   %PUBLIC_URL%/caster
echo.
echo Overlay:
echo   %PUBLIC_URL%/overlay/draft
echo.
echo Saved to artifacts\current-public-url.txt
echo Keep this launcher open during broadcast. Closing it stops services started by this launch.
echo Press any key below to stop this launch. Existing reused sessions remain running.
echo ==========================================
echo.
pause
endlocal
