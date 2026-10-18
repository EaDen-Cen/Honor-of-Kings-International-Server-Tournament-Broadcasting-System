# Cross-platform launcher checks. CIM lookup and taskkill are mocked, so this
# script never starts or stops a Windows service or an existing application.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$parsePaths = @('run-server.ps1', 'run-cloudflare.ps1', 'run-bp-simulator.ps1', 'open-director.ps1',
    'scripts/managed-process.ps1', 'scripts/stop-managed.ps1', 'scripts/managed-process.test.ps1')
foreach ($path in $parsePaths) {
    $tokens = $null; $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile((Join-Path $projectRoot $path), [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count) { throw "PowerShell syntax error in ${path}: $parseErrors" }
}
. (Join-Path $PSScriptRoot 'managed-process.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ("HOK path ! ' test " + [guid]::NewGuid())
New-Item -ItemType Directory -Path (Join-Path $root 'artifacts') -Force | Out-Null
$script:creationDate = [datetime]::UtcNow
$script:fakeProcess = [pscustomobject]@{
    ProcessId = $PID
    CreationDate = $script:creationDate
    CommandLine = ('powershell.exe -File "{0}"' -f (Join-Path $root 'run-server.ps1'))
}
function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) $script:fakeProcess }
$script:kills = @()
$script:onKill = $null
function taskkill.exe {
    $script:kills += ,@($args)
    if ($script:onKill) { & $script:onKill }
    $global:LASTEXITCODE = 0
}
function Assert-Equal($Actual, $Expected, $Message) {
    if ($Actual -ne $Expected) { throw "${Message}: expected '$Expected', got '$Actual'" }
}
$processLock = $null
try {
    Register-HokManagedProcess -Root $root -Name server -Script (Join-Path $root 'run-server.ps1') -Port 3001
    Assert-Equal (Get-HokManagedProcess -Root $root -Name server).Record.port 3001 'Own process recognized with spaces, apostrophe and !'
    $rejected = $false
    try { Assert-HokDependenciesStopped -Root $root } catch { $rejected = $true }
    Assert-Equal $rejected $true 'Dependency replacement is blocked while the project is running'
    $marker = Get-HokProcessPath -Root $root -Name server
    $original = Get-Content -LiteralPath $marker -Raw
    $record = $original | ConvertFrom-Json
    $record.root = Join-Path $root 'another-checkout'
    $record | ConvertTo-Json | Set-Content -LiteralPath $marker
    Stop-HokManagedProcess -Root $root -Name server
    Assert-Equal $script:kills.Count 0 'Different checkout never stopped'
    Set-Content -LiteralPath $marker -Value $original
    Copy-Item -LiteralPath $marker -Destination (Get-HokProcessPath -Root $root -Name tunnel)
    Stop-HokManagedProcess -Root $root -Name tunnel
    Assert-Equal $script:kills.Count 0 'Different role never stopped'
    $script:fakeProcess.CreationDate = $script:creationDate.AddSeconds(1)
    Stop-HokManagedProcess -Root $root -Name server
    Assert-Equal $script:kills.Count 0 'Reused PID never stopped'
    $script:fakeProcess.CreationDate = $script:creationDate
    $script:fakeProcess.CommandLine = 'powershell.exe -File "C:\Other project\run-server.ps1"'
    Stop-HokManagedProcess -Root $root -Name server
    Assert-Equal $script:kills.Count 0 'Foreign process never stopped'
    $script:fakeProcess.CommandLine = ('powershell.exe -File "{0}"' -f (Join-Path $root 'run-server.ps1'))
    Set-Content -LiteralPath $marker -Value '{invalid json'
    Stop-HokManagedProcess -Root $root -Name server
    Assert-Equal $script:kills.Count 0 'Damaged marker never stops a process'
    Register-HokManagedProcess -Root $root -Name server -Script (Join-Path $root 'run-server.ps1') -Port 3001
    Assert-Equal ($null -ne (Get-HokManagedProcess -Root $root -Name server)) $true 'Damaged marker replaced on next verified startup'
    Stop-HokManagedProcess -Root $root -Name server
    Stop-HokManagedProcess -Root $root -Name server
    Assert-Equal $script:kills.Count 1 'Owned process stopped once'
    Assert-Equal ($script:kills[0] -join ' ') "/PID $PID /T /F" 'Only the verified process tree is targeted'
    Assert-Equal (Test-Path -LiteralPath $marker) $false 'Stopped marker cleaned'
    Assert-HokDependenciesStopped -Root $root

    Register-HokManagedProcess -Root $root -Name server -Script (Join-Path $root 'run-server.ps1') -Port 3001
    $script:onKill = {
        $replacement = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
        $replacement.startedAtTicks = [string]$script:creationDate.AddSeconds(1).Ticks
        $replacement | ConvertTo-Json | Set-Content -LiteralPath $marker
    }
    Stop-HokManagedProcess -Root $root -Name server
    Assert-Equal (Test-Path -LiteralPath $marker) $true 'Concurrent replacement marker is preserved'
    $script:onKill = $null
    Remove-Item -LiteralPath $marker

    $processLock = Enter-HokProcessLock -Root $root -Name server
    $child = Join-Path $root 'check-lock.ps1'
    @'
param($Root, $Helper)
. $Helper
try { $lock = Enter-HokProcessLock -Root $Root -Name server; $lock.ReleaseMutex(); $lock.Dispose(); exit 0 }
catch { exit 9 }
'@ | Set-Content -LiteralPath $child
    $shell = (Get-Process -Id $PID).Path
    & $shell -NoProfile -ExecutionPolicy Bypass -File $child -Root $root -Helper (Join-Path $PSScriptRoot 'managed-process.ps1')
    Assert-Equal $LASTEXITCODE 9 'Duplicate launch cannot acquire the mutex'
    $processLock.ReleaseMutex(); $processLock.Dispose(); $processLock = $null
    & $shell -NoProfile -ExecutionPolicy Bypass -File $child -Root $root -Helper (Join-Path $PSScriptRoot 'managed-process.ps1')
    Assert-Equal $LASTEXITCODE 0 'Mutex released for later startup'

    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Server.ExclusiveAddressUse = $true; $listener.Start()
        $occupiedPort = $listener.LocalEndpoint.Port
        $rejected = $false
        try { Assert-HokPortAvailable -Port $occupiedPort } catch { $rejected = $true }
        Assert-Equal $rejected $true 'Occupied port is rejected'
    } finally { $listener.Stop() }
    Assert-HokPortAvailable -Port $occupiedPort
    Write-Output 'PASS: launcher syntax, scoped ownership, PID reuse, damaged state, duplicate stop, concurrent startup, path quoting and port conflicts'
} finally {
    if ($processLock) { $processLock.ReleaseMutex(); $processLock.Dispose() }
    Remove-Item -LiteralPath $root -Force -Recurse
}
