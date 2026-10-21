param([switch]$Background, [switch]$GetUrl)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts/managed-process.ps1')
. (Join-Path $PSScriptRoot 'scripts/tunnel-sync.ps1')
$artifactDir = Join-Path $PSScriptRoot 'artifacts'
$log = Join-Path $artifactDir 'cloudflared.log'
$urlFile = Join-Path $artifactDir 'current-public-url.txt'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$running = Get-HokManagedProcess -Root $PSScriptRoot -Name tunnel
if ($GetUrl) {
    if (-not $running -or -not (Test-Path -LiteralPath $urlFile)) { exit 1 }
    $origin = Get-Content -LiteralPath $urlFile -TotalCount 1
    if (-not (Test-HokTunnelOrigin $origin)) { exit 1 }
    Write-Output $origin
    exit 0
}
if ($running) { Write-Host 'HOK Cloudflare tunnel is already running. Reusing this session.'; exit 0 }
if ($Background) {
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $PSScriptRoot -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath)
    exit 0
}
$processLock = Enter-HokProcessLock -Root $PSScriptRoot -Name tunnel
$child = $null
$reader = $null
try {
    Register-HokManagedProcess -Root $PSScriptRoot -Name tunnel -Script $PSCommandPath
    $cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
    $config = Get-HokSyncConfig -Root $PSScriptRoot
    if (-not $config) { Write-Host 'Sites auto-sync disabled. Configure TUNNEL_SYNC_TOKEN or use manual website setup.' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-HokSyncHealth 'http://127.0.0.1:3001') { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Local backend not ready.' }
    # Restart only an exited tunnel, at most five times. Never restart HOK.
    for ($restart = 0; $restart -lt 5; $restart++) {
        if (Test-Path -LiteralPath $urlFile) { Remove-Item -LiteralPath $urlFile -Force }
        $stderr = Join-Path $artifactDir 'cloudflared-stderr.log'
        $stdout = Join-Path $artifactDir 'cloudflared-stdout.log'
        $child = Start-Process -FilePath $cloudflared -WindowStyle Hidden -ArgumentList 'tunnel --url http://127.0.0.1:3001' -RedirectStandardError $stderr -RedirectStandardOutput $stdout -PassThru
        $stream = [IO.File]::Open($stderr, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        $reader = New-Object IO.StreamReader($stream)
        $origin = ''; $pendingLine = ''; $syncAttempts = 0; $healthAttempts = 0; $syncDone = $false; $nextSync = [datetime]::MinValue
        while (-not $child.HasExited) {
            # Read only appended bytes and preserve incomplete log lines.
            $pendingLine += $reader.ReadToEnd()
            $lines = $pendingLine -split "`n"
            $pendingLine = $lines[-1]
            for ($i = 0; $i -lt $lines.Count - 1; $i++) {
                $line = $lines[$i].TrimEnd("`r")
                Add-Content -LiteralPath $log -Value $line -Encoding UTF8
                $found = Get-HokTunnelOrigin $line
                if ($found -and $found -ne $origin) {
                    $origin = $found; $syncAttempts = 0; $healthAttempts = 0; $syncDone = $false; $nextSync = [datetime]::MinValue
                    Set-Content -LiteralPath $urlFile -Value $origin -Encoding ASCII
                    Write-Host "Public tunnel: $origin"
                }
            }
            if ($origin -and $config -and -not $syncDone -and [datetime]::UtcNow -ge $nextSync) {
                $result = Invoke-HokTunnelSync -Origin $origin -Config $config
                if ($result -eq 'not-ready') { $healthAttempts++ } else { $syncAttempts++ }
                $syncDone = $result -in @('synced','unauthorized','unavailable') -or $syncAttempts -ge 3 -or $healthAttempts -ge 12
                $nextSync = [datetime]::UtcNow.AddSeconds(5 * [Math]::Max(1,$syncAttempts))
                Write-Host "Sites sync: $result (local broadcast continues)."
                if ($syncDone -and $result -ne 'synced') { Write-Warning 'Use manual website setup or restart only the tunnel after correcting configuration/deploying the API.' }
            }
            Start-Sleep -Milliseconds 500
            $child.Refresh()
        }
        $reader.Dispose(); $reader = $null
        $child.Dispose(); $child = $null
        if (Test-Path -LiteralPath $urlFile) { Remove-Item -LiteralPath $urlFile -Force }
        Start-Sleep -Seconds ([Math]::Min(15,2 * ($restart + 1)))
    }
    Write-Warning 'Tunnel retry limit reached. HOK local server is still running.'
} catch {
    # Fixed diagnostics avoid accidentally logging HTTP credentials.
    Write-Warning 'Tunnel stopped. Check cloudflared installation, local health and artifacts/cloudflared.log.'
} finally {
    if ($reader) { $reader.Dispose() }
    if ($child) { $child.Refresh(); if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }; $child.Dispose() }
    if (Test-Path -LiteralPath $urlFile) { Remove-Item -LiteralPath $urlFile -Force }
    Remove-HokManagedProcess -Root $PSScriptRoot -Name tunnel
    $processLock.ReleaseMutex(); $processLock.Dispose()
}
