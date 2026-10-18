param(
    [string]$Url = 'http://127.0.0.1:3001/control'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$profile = Join-Path $root 'data/director-browser-profile'
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft/Edge/Application/msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google/Chrome/Application/chrome.exe'),
    (Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft/Edge/Application/msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google/Chrome/Application/chrome.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$browser = $candidates | Select-Object -First 1
if (-not $browser) {
    foreach ($name in @('msedge.exe','chrome.exe')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) { $browser = $command.Source; break }
    }
}

if (-not $browser) {
    Write-Warning 'Edge/Chrome was not found. Falling back to the default browser.'
    Start-Process $Url
    exit 0
}

$arguments = @(
    ('--app="{0}"' -f $Url),
    ('--user-data-dir="{0}"' -f $profile),
    '--profile-directory=Default',
    '--start-maximized',
    '--disable-pinch',
    '--overscroll-history-navigation=0',
    '--no-first-run',
    '--no-default-browser-check'
)

Start-Process -FilePath $browser -ArgumentList $arguments
