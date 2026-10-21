$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required' }
$project = Split-Path -Parent $PSScriptRoot
$temporary = Join-Path $project ('artifacts/session-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path (Join-Path $temporary 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launcher-session.ps1') -Destination (Join-Path $temporary 'scripts/launcher-session.ps1')
Set-Content -LiteralPath (Join-Path $temporary 'start-broadcast.bat') -Encoding ASCII -Value '@powershell.exe -NoProfile -File child.ps1'
Set-Content -LiteralPath (Join-Path $temporary 'child.ps1') -Value '$PID | Set-Content child-pid.txt; Start-Sleep -Seconds 120'
$supervisor = $null; $unrelated = $null
try {
    $unrelated = Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 120"' -PassThru
    $supervisor = Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $temporary 'scripts/launcher-session.ps1')) -PassThru
    $deadline = [datetime]::UtcNow.AddSeconds(15)
    while (-not (Test-Path -LiteralPath (Join-Path $temporary 'child-pid.txt')) -and [datetime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    $childId = [int](Get-Content -LiteralPath (Join-Path $temporary 'child-pid.txt'))
    $child = Get-Process -Id $childId
    $supervisor.Kill(); $supervisor.WaitForExit()
    if (-not $child.WaitForExit(10000)) { throw 'Closing launcher left its child running' }
    $unrelated.Refresh()
    if ($unrelated.HasExited) { throw 'Closing launcher affected an unrelated process' }
    Write-Host 'PASS: abrupt launcher exit cleans its child tree and preserves unrelated processes.'
} finally {
    foreach ($process in @($supervisor,$unrelated)) {
        if ($process) { $process.Refresh(); if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }; $process.Dispose() }
    }
    # Explicitly verify the only recursive-delete target is this test fixture.
    $resolved = [IO.Path]::GetFullPath($temporary)
    $allowed = [IO.Path]::GetFullPath((Join-Path $project 'artifacts')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
