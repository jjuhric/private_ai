# Windows Uninstall Script for Private AI Assistant
# Removes background tasks, running port processes, environment configurations, logs, databases, and dependencies

Write-Host "=============================================" -ForegroundColor Red
Write-Host "❌ Uninstalling Private AI Assistant Node" -ForegroundColor Red
Write-Host "=============================================" -ForegroundColor Red

# 1. Stop and remove scheduled tasks (requires Admin)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
    Write-Host "Cleaning Windows background tasks..." -ForegroundColor Cyan
    $tasks = @("PrivateAI-Assistant", "PrivateAI-Updater")
    foreach ($taskName in $tasks) {
        $taskExists = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($taskExists) {
            Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
            Write-Host "✅ Removed background scheduled task: $taskName" -ForegroundColor Green
        }
    }
} else {
    Write-Host "[WARNING] Please run this script in an Administrator PowerShell window to clean up background scheduled tasks." -ForegroundColor Yellow
}

# 2. Kill running backend processes on PORT 3000 (or customized port from .env)
$appPort = 3000
if (Test-Path ".env") {
    $envLines = Get-Content ".env"
    foreach ($line in $envLines) {
        if ($line -match "^PORT=(.*)") { $appPort = $Matches[1].Trim() }
    }
}

$portProcess = Get-NetTCPConnection -LocalPort $appPort -State Listen -ErrorAction SilentlyContinue
if ($portProcess) {
    $procId = $portProcess.OwningProcess
    Write-Host "Stopping running process $procId on port $appPort..." -ForegroundColor Yellow
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Stopped active port process." -ForegroundColor Green
}

# 3. Clean files, databases, and local staging directories
Write-Host "Deleting configuration files, logs, and database files..." -ForegroundColor Cyan
if (Test-Path ".env") { Remove-Item ".env" -Force -ErrorAction SilentlyContinue }
if (Test-Path "app.log") { Remove-Item "app.log" -Force -ErrorAction SilentlyContinue }

$dbPath = "backend/database.db"
foreach ($suffix in ("", "-wal", "-shm")) {
    $file = $dbPath + $suffix
    if (Test-Path $file) {
        Remove-Item $file -Force -ErrorAction SilentlyContinue
    }
}

foreach ($suffix in ("", "-wal", "-shm")) {
    $file = "backend/test_database.db" + $suffix
    if (Test-Path $file) {
        Remove-Item $file -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path "tool_registry/staging") { Remove-Item "tool_registry/staging" -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path "tool_registry/tools") { Remove-Item "tool_registry/tools" -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "✅ Environment configuration, logs, and databases removed." -ForegroundColor Green

# 4. Remove NPM dependencies and frontend build outputs
Write-Host "Deleting node_modules directories and compiled frontend build..." -ForegroundColor Cyan
$folders = @("node_modules", "backend/node_modules", "frontend/node_modules", "frontend/dist")
foreach ($folder in $folders) {
    if (Test-Path $folder) {
        Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "✅ Dependencies and built assets cleaned." -ForegroundColor Green

Write-Host "`n=============================================" -ForegroundColor Green
Write-Host "  Private AI has been uninstalled successfully!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
