# Shared by the Windows launchers. Only processes started for this checkout are
# reusable/stoppable; a port number or executable name is never ownership proof.
function Get-HokProcessPath {
    param([string]$Root, [ValidateSet('server', 'tunnel', 'simulator')][string]$Name)
    Join-Path $Root "artifacts/$Name-process.json"
}

function Get-HokManagedProcess {
    param([string]$Root, [ValidateSet('server', 'tunnel', 'simulator')][string]$Name)
    $path = Get-HokProcessPath -Root $Root -Name $Name
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
        $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        $expectedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
        $scriptName = @{ server = 'run-server.ps1'; tunnel = 'run-cloudflare.ps1'; simulator = 'run-bp-simulator.ps1' }[$Name]
        $expectedScript = Join-Path $expectedRoot $scriptName
        if ($record.root -ne $expectedRoot -or $record.name -ne $Name -or $record.processId -lt 1 -or $record.script -ne $expectedScript) { return $null }
        $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $([int]$record.processId)" -ErrorAction Stop
        if (-not $process -or [string]$process.CreationDate.ToUniversalTime().Ticks -ne [string]$record.startedAtTicks -or
            -not $process.CommandLine -or $process.CommandLine.IndexOf($expectedScript, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $null }
        [pscustomobject]@{ Process = $process; Record = $record }
    } catch { return $null }
}

function Enter-HokProcessLock {
    param([string]$Root, [ValidateSet('server', 'tunnel', 'simulator', 'prepare')][string]$Name)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar).ToLowerInvariant())
        $hash = [BitConverter]::ToString($algorithm.ComputeHash($bytes)).Replace('-', '')
    } finally { $algorithm.Dispose() }
    $mutex = New-Object Threading.Mutex($false, "HokBroadcast-$hash-$Name")
    $acquired = $false
    try { $acquired = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { $mutex.Dispose(); throw "$Name is already starting or running for this project. Wait for it to become ready." }
    $mutex
}

function Register-HokManagedProcess {
    param([string]$Root, [ValidateSet('server', 'tunnel', 'simulator')][string]$Name, [string]$Script, [int]$Port = 0)
    $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop
    if (-not $process) { throw 'Cannot identify the launcher process; startup stopped.' }
    $record = @{
        root = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
        name = $Name
        processId = $PID
        startedAtTicks = [string]$process.CreationDate.ToUniversalTime().Ticks
        script = [IO.Path]::GetFullPath($Script)
        port = $Port
    }
    $path = Get-HokProcessPath -Root $Root -Name $Name
    $temporary = "$path.$PID.tmp"
    $record | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $path -Force
}

function Remove-HokManagedProcess {
    param([string]$Root, [ValidateSet('server', 'tunnel', 'simulator')][string]$Name)
    $path = Get-HokProcessPath -Root $Root -Name $Name
    if (-not (Test-Path -LiteralPath $path)) { return }
    try {
        $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ($record.processId -eq $PID) { Remove-Item -LiteralPath $path -Force }
    } catch { Write-Warning "Could not remove the $Name launcher record: $_" }
}

function Assert-HokPortAvailable {
    param([ValidateRange(1, 65535)][int]$Port)
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
    try { $listener.Server.ExclusiveAddressUse = $true; $listener.Start() }
    catch { throw "Port $Port is already in use. Close that application or choose another port; no process was stopped." }
    finally { $listener.Stop() }
}

function Assert-HokDependenciesStopped {
    param([string]$Root)
    foreach ($name in @('server', 'simulator')) {
        if (Get-HokManagedProcess -Root $Root -Name $name) { throw 'Stop Broadcast and Simulator before updating their shared dependencies, then start again.' }
    }
}

function Stop-HokManagedProcess {
    param([string]$Root, [ValidateSet('server', 'tunnel', 'simulator')][string]$Name)
    $managed = Get-HokManagedProcess -Root $Root -Name $Name
    if (-not $managed) { Write-Host "No verified HOK $Name process is running for this project."; return }
    & taskkill.exe /PID $managed.Record.processId /T /F
    if ($LASTEXITCODE -ne 0) { throw "Could not stop HOK $Name. Check the error above." }
    $path = Get-HokProcessPath -Root $Root -Name $Name
    if (Test-Path -LiteralPath $path) {
        $current = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ($current.processId -eq $managed.Record.processId -and $current.startedAtTicks -eq $managed.Record.startedAtTicks) {
            Remove-Item -LiteralPath $path -Force
        }
    }
}
