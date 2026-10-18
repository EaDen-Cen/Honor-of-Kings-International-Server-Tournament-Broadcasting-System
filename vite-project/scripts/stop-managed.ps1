param([ValidateSet('broadcast', 'simulator')][string]$Target = 'broadcast')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'managed-process.ps1')
$failed = $false
$names = if ($Target -eq 'broadcast') { @('tunnel', 'server') } else { @('simulator') }
foreach ($name in $names) {
    try { Stop-HokManagedProcess -Root $root -Name $name }
    catch { Write-Warning $_; $failed = $true }
}
if ($failed) { exit 1 }
if ($Target -eq 'broadcast') {
    $urlFile = Join-Path $root 'artifacts/current-public-url.txt'
    if (Test-Path -LiteralPath $urlFile) { Remove-Item -LiteralPath $urlFile -Force }
}
exit 0
