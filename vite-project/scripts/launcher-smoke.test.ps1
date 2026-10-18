# Real Windows process lifecycle checks; desktop capture and OBS are not used.
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This smoke test requires Windows.' }
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'managed-process.ps1')
if (Get-HokManagedProcess -Root $root -Name server) { throw 'Stop the existing project server before running this test.' }
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('hok-launcher-smoke-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
$environment = @{
    DATA_FILE = (Join-Path $temporary 'match.json')
    UPLOAD_DIR = (Join-Path $temporary 'uploads')
    CONTROL_TOKEN = 'launcher-smoke-control'
    CASTER_TOKEN = 'launcher-smoke-caster'
    OVERLAY_TOKEN = 'launcher-smoke-overlay'
    ACCESS_PASSWORD = ''
    NODE_ENV = 'development'
}
$previous = @{}
$unrelated = $null
$started = $false
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
function Invoke-Launcher {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root 'run-server.ps1') -Background -Port $port
    if ($LASTEXITCODE -ne 0) { throw 'Background launcher failed.' }
}
function Test-Health {
    try { (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2).StatusCode -eq 200 }
    catch { $false }
}
try {
    foreach ($key in $environment.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process')
    }
    $unrelated = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 120"' -PassThru
    $started = $true
    Invoke-Launcher
    $deadline = [datetime]::UtcNow.AddSeconds(40)
    do {
        $managed = Get-HokManagedProcess -Root $root -Name server
        if ($managed -and (Test-Health)) { break }
        Start-Sleep -Milliseconds 250
    } while ([datetime]::UtcNow -lt $deadline)
    if (-not $managed -or -not (Test-Health)) { throw 'Managed server did not become healthy.' }
    $firstProcessId = $managed.Record.processId
    Invoke-Launcher
    $reused = Get-HokManagedProcess -Root $root -Name server
    if (-not $reused -or $reused.Record.processId -ne $firstProcessId) { throw 'Repeated launch did not reuse the healthy process.' }
    Stop-HokManagedProcess -Root $root -Name server
    $deadline = [datetime]::UtcNow.AddSeconds(10)
    while ((Test-Health) -and [datetime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if (Test-Health) { throw 'Stopping the launcher left the server listening.' }
    if (Get-HokManagedProcess -Root $root -Name server) { throw 'Managed process record survived stop.' }
    $unrelated.Refresh()
    if ($unrelated.HasExited) { throw 'Stopping the project affected an unrelated process.' }
    Stop-HokManagedProcess -Root $root -Name server
    Write-Host 'PASS: native Windows startup, health, repeated launch, complete stop and unrelated process isolation.'
} finally {
    if ($started) { Stop-HokManagedProcess -Root $root -Name server }
    if ($unrelated) { $unrelated.Refresh(); if (-not $unrelated.HasExited) { $unrelated.Kill(); $unrelated.WaitForExit() }; $unrelated.Dispose() }
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    Remove-Item -LiteralPath $temporary -Recurse -Force
}
