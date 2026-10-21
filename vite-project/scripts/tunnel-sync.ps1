# Functions only: dot-source from the tunnel supervisor and deterministic tests.
# Do not log request objects, headers, exception bodies or configuration content.
function Get-HokTunnelOrigin {
    param([string]$Line)
    # The quick-tunnel announcement prints a boxed URL on a line by itself.
    # A URL in a help message, request log, suffix domain or query is not proof.
    if ($Line -cmatch '^.*?\|\s+(https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com)\s+\|\s*$') { return $Matches[1] }
    return $null
}
function Test-HokTunnelOrigin {
    param([string]$Origin)
    return $Origin -cmatch '^https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$'
}
function Get-HokSyncConfig {
    param([string]$Root)
    $token = $env:TUNNEL_SYNC_TOKEN
    $path = Join-Path $Root 'tunnel-sync.local.json'
    if (-not $token -and (Test-Path -LiteralPath $path)) {
        try { $token = (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json).token }
        catch { Write-Warning 'Sites sync configuration is invalid; local broadcast continues.'; return $null }
    }
    if (-not $token) { return $null }
    if ($token -isnot [string] -or $token.Length -lt 16 -or $token.Length -gt 512 -or $token -notmatch '^[\x21-\x7e]+$') {
        Write-Warning 'Sites sync token has an invalid format; local broadcast continues.'; return $null
    }
    # Fixed destination prevents an edited URL from redirecting the sync secret.
    return @{ Token = $token; Endpoint = 'https://chasingwind-esport.prettyelm1.chatgpt.site/gateway/api/tunnel' }
}
function Test-HokSyncHealth {
    param([string]$Origin)
    try {
        $reply = Invoke-WebRequest -UseBasicParsing -Uri "$Origin/api/health" -MaximumRedirection 0 -TimeoutSec 4 -ErrorAction Stop
        return $reply.StatusCode -eq 200 -and ($reply.Content | ConvertFrom-Json).ok -eq $true
    } catch { return $false }
}
function Invoke-HokTunnelSync {
    param([string]$Origin, [hashtable]$Config)
    if (-not (Test-HokTunnelOrigin $Origin) -or -not $Config) { return 'disabled' }
    # Local and public readiness are checked on every attempt. Ownership and
    # access-policy validation remain the Sites API's responsibility, not health.
    if (-not (Test-HokSyncHealth 'http://127.0.0.1:3001') -or -not (Test-HokSyncHealth $Origin)) { return 'not-ready' }
    try {
        $reply = Invoke-WebRequest -UseBasicParsing -Uri $Config.Endpoint -Method Put -MaximumRedirection 0 -TimeoutSec 5 -ContentType 'application/json' -Headers @{ Authorization = 'Bearer ' + $Config.Token } -Body (@{origin=$Origin} | ConvertTo-Json -Compress) -ErrorAction Stop
        if ($reply.StatusCode -ge 200 -and $reply.StatusCode -lt 300) { return 'synced' }
        return 'retry'
    } catch {
        $status = 0
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        if ($status -eq 401 -or $status -eq 403) { return 'unauthorized' }
        if ($status -eq 404 -or $status -eq 405 -or $status -eq 501) { return 'unavailable' }
        return 'retry'
    }
}
