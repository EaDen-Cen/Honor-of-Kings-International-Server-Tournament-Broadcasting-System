$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tunnel-sync.ps1')
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
Assert ((Get-HokTunnelOrigin '2026-10-20T00:00:00Z INF | https://unit-test-url.trycloudflare.com  |') -eq 'https://unit-test-url.trycloudflare.com') 'Real boxed URL not parsed'
foreach ($line in @('help https://unit-test.trycloudflare.com','| https://test.trycloudflare.com.evil.test |','| http://test.trycloudflare.com |','| https://test.trycloudflare.com/x |','| https://test.trycloudflare.com?token=x |')) {
    Assert (-not (Get-HokTunnelOrigin $line)) 'Untrusted log URL accepted'
}
# Replace network functions in this script scope: no real tokens or egress.
$script:healthy = $true
function Test-HokSyncHealth { param($Origin) return $script:healthy }
$script:mode = 200
$script:puts = 0
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, $Uri, $Method, $MaximumRedirection, $TimeoutSec, $ContentType, $Headers, $Body, $ErrorAction)
    $script:puts++
    Assert ($Method -eq 'Put' -and $MaximumRedirection -eq 0 -and $TimeoutSec -le 5) 'Unsafe request settings'
    Assert ($Uri -eq 'https://chasingwind-esport.prettyelm1.chatgpt.site/gateway/api/tunnel') 'Unexpected destination'
    Assert ($Headers.Authorization -eq 'Bearer fake-test-only-token') 'Missing auth'
    Assert (($Body | ConvertFrom-Json).origin -eq 'https://unit-test.trycloudflare.com') 'Wrong payload'
    if ($script:mode -ne 200) {
        $exception = New-Object Exception('private provider body should never appear')
        $exception | Add-Member -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{StatusCode=$script:mode})
        throw $exception
    }
    return [pscustomobject]@{StatusCode=200}
}
$config=@{Token='fake-test-only-token';Endpoint='https://chasingwind-esport.prettyelm1.chatgpt.site/gateway/api/tunnel'}
Assert ((Invoke-HokTunnelSync 'https://unit-test.trycloudflare.com' $config) -eq 'synced') 'Success failed'
foreach ($pair in @(@(401,'unauthorized'),@(403,'unauthorized'),@(404,'unavailable'),@(405,'unavailable'),@(429,'retry'),@(500,'retry'))) {
    $script:mode=$pair[0]
    Assert ((Invoke-HokTunnelSync 'https://unit-test.trycloudflare.com' $config) -eq $pair[1]) 'HTTP failure classification wrong'
}
$script:healthy=$false
$before=$script:puts
Assert ((Invoke-HokTunnelSync 'https://unit-test.trycloudflare.com' $config) -eq 'not-ready') 'Health gate failed'
Assert ($before -eq $script:puts) 'PUT happened before readiness'
Assert ((Invoke-HokTunnelSync 'https://127.0.0.1' $config) -eq 'disabled') 'Local target accepted'
Write-Host 'PASS: tunnel parsing, readiness, authenticated PUT, no redirects, unavailable API and bounded failures.'
