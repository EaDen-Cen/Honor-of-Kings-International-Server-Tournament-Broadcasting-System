param([switch]$Background, [switch]$GetUrl)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts/managed-process.ps1')
$artifactDir = Join-Path $PSScriptRoot 'artifacts'
$log = Join-Path $artifactDir 'cloudflared.log'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$running = Get-HokManagedProcess -Root $PSScriptRoot -Name tunnel
if ($GetUrl) {
    if (-not $running -or -not (Test-Path -LiteralPath $log)) { exit 1 }
    $urlMatches = [regex]::Matches((Get-Content -Raw -LiteralPath $log), 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
    if (-not $urlMatches.Count) { exit 1 }
    Write-Output $urlMatches[$urlMatches.Count - 1].Value
    exit 0
}
if ($running) { Write-Host 'HOK Cloudflare tunnel is already running. Reusing this session.'; exit 0 }
if ($Background) {
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $PSScriptRoot -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath)
    exit 0
}
$processLock = Enter-HokProcessLock -Root $PSScriptRoot -Name tunnel
$exitCode = 1
try {
    if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
    $urlFile = Join-Path $artifactDir 'current-public-url.txt'
    if (Test-Path -LiteralPath $urlFile) { Remove-Item -LiteralPath $urlFile -Force }
    Register-HokManagedProcess -Root $PSScriptRoot -Name tunnel -Script $PSCommandPath
    Get-Command cloudflared -ErrorAction Stop | Out-Null
    # cloudflared emits startup information on stderr; keep it in the log.
    $ErrorActionPreference = 'Continue'
    & cloudflared tunnel --url http://127.0.0.1:3001 2>&1 |
        ForEach-Object { $line = $_.ToString(); $line; Add-Content -LiteralPath $log -Value $line -Encoding UTF8 }
    $exitCode = $LASTEXITCODE
} catch {
    $_ | Out-String | Add-Content -LiteralPath $log
} finally {
    Remove-HokManagedProcess -Root $PSScriptRoot -Name tunnel
    $processLock.ReleaseMutex()
    $processLock.Dispose()
}
exit $exitCode
