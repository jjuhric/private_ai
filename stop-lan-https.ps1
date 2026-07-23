$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$backendPidFile = Join-Path $root ".backend.pid"
$caddyPidFile = Join-Path $root ".caddy.pid"

function Stop-ManagedProcess {
    param(
        [string]$Name,
        [string]$PidFile
    )

    if (-not (Test-Path $PidFile)) {
        Write-Output "$Name PID file not found; nothing to stop."
        return
    }

    $pidText = (Get-Content $PidFile -Raw).Trim()
    if ($pidText -notmatch '^\d+$') {
        Remove-Item $PidFile -Force
        Write-Output "$Name PID file was invalid and has been removed."
        return
    }

    $procId = [int]$pidText
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
        Stop-Process -Id $procId -Force
        Write-Output "$Name stopped (PID $procId)."
    } else {
        Write-Output "$Name process with PID $procId not found."
    }

    Remove-Item $PidFile -Force
}

Stop-ManagedProcess -Name "Caddy" -PidFile $caddyPidFile
Stop-ManagedProcess -Name "Backend" -PidFile $backendPidFile
