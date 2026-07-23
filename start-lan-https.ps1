param(
    [string]$HostIp = "192.168.1.42",
    [int]$BackendPort = 3000,
    [string]$BackendHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$backendPidFile = Join-Path $root ".backend.pid"
$caddyPidFile = Join-Path $root ".caddy.pid"
$caddyfilePath = Join-Path $root "Caddyfile"

function Get-CaddyExe {
    $cmd = Get-Command caddy -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    $wingetPath = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe\caddy.exe"
    if (Test-Path $wingetPath) {
        return $wingetPath
    }

    throw "Caddy executable not found. Install with: winget install --id CaddyServer.Caddy -e --scope user"
}

function Start-ManagedProcess {
    param(
        [string]$Name,
        [string]$Exe,
        [string[]]$ProcessArgs,
        [string]$PidFile
    )

    if (Test-Path $PidFile) {
        $existingPid = (Get-Content $PidFile -Raw).Trim()
        if ($existingPid -match '^\d+$') {
            $proc = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Output "$Name already running (PID $existingPid)."
                return
            }
        }
        Remove-Item $PidFile -Force
    }

    $proc = Start-Process -FilePath $Exe -ArgumentList $ProcessArgs -WorkingDirectory $root -PassThru -WindowStyle Hidden
    Set-Content -Path $PidFile -Value $proc.Id -NoNewline
    Write-Output "$Name started (PID $($proc.Id))."
}

$caddyfileContent = @"
https://$HostIp {
    tls internal
    reverse_proxy $BackendHost`:$BackendPort
}
"@

Set-Content -Path $caddyfilePath -Value $caddyfileContent
Write-Output "Wrote Caddy config to $caddyfilePath"

$caddyExe = Get-CaddyExe

Start-ManagedProcess -Name "Backend" -Exe "node" -ProcessArgs @("backend/server.js") -PidFile $backendPidFile
Start-ManagedProcess -Name "Caddy" -Exe $caddyExe -ProcessArgs @("run", "--config", $caddyfilePath) -PidFile $caddyPidFile

Start-Sleep -Milliseconds 600

Write-Output ""
Write-Output "LAN HTTPS is starting up:"
Write-Output "- App URL: https://$HostIp"
Write-Output "- Health URL: https://$HostIp/health"
Write-Output ""
Write-Output "PID files:"
Write-Output "- $backendPidFile"
Write-Output "- $caddyPidFile"
Write-Output ""
Write-Output "If this is the first run, trust Caddy root cert on your phone from:"
Write-Output "$env:APPDATA\Caddy\pki\authorities\local\root.crt"
