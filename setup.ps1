# Windows Setup & Update Script for Private AI Assistant
# Requires PowerShell 5.1 or higher

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Private AI Assistant Windows Setup Utility V4.0.0 " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Helper function for logs
function Write-Log ($Msg, $Color = "White") {
    Write-Host "`n[INFO] $Msg" -ForegroundColor $Color
}

# 2. Check Prerequisites
Write-Log "Checking system prerequisites..."

# Verify Git
$gitCheck = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCheck) {
    Write-Host "[ERROR] Git is not installed on this system. Please install Git for Windows (https://git-scm.com/) and run this setup again." -ForegroundColor Red
    Exit 1
} else {
    Write-Log "Git is installed." "Green"
}

# Verify Node.js
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCheck) {
    Write-Host "[ERROR] Node.js is not installed on this system. Please install Node.js v25+ (https://nodejs.org/) and run this setup again." -ForegroundColor Red
    Exit 1
} else {
    $nodeVer = & node -v
    Write-Log "Node.js $nodeVer is installed." "Green"
}

# 3. Pull latest git changes if in a repo clone
if (Test-Path ".git") {
    Write-Log "Repository detected. Fetching latest commits..."
    & git pull
}

# 4. Interactive Prompts
Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "  Configuration Settings" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

$deviceType = Read-Host "Enter Device Type (windows, linux, rpi-5-8gb, rpi-zero-2w, esp32) [windows]"
if ([string]::IsNullOrWhiteSpace($deviceType)) { $deviceType = "windows" }

$isMainHostYN = Read-Host "Should this node act as a Main Host (runs LLMs, chat UI, etc)? (y/n) [y]"
if ([string]::IsNullOrWhiteSpace($isMainHostYN)) { $isMainHostYN = "y" }
$isMainHost = "0"
if ($isMainHostYN -eq "y" -or $isMainHostYN -eq "Y") {
    $isMainHost = "1"
}

$adminUser = Read-Host "Enter Admin Username [admin]"
if ([string]::IsNullOrWhiteSpace($adminUser)) { $adminUser = "admin" }

$adminPass = Read-Host "Enter Admin Password [adminpassword]"
if ([string]::IsNullOrWhiteSpace($adminPass)) { $adminPass = "adminpassword" }

$localUrl = Read-Host "Enter Local LLM Base URL [http://localhost:1234/v1]"
if ([string]::IsNullOrWhiteSpace($localUrl)) { $localUrl = "http://localhost:1234/v1" }

$localKey = Read-Host "Enter Local LLM API Key (optional)"
$onlineKey = Read-Host "Enter Online Gemini API Key (optional)"
$githubToken = Read-Host "Enter GitHub Access Token (optional)"

$buildFeYN = Read-Host "Build React Frontend on this node? (y/n) [y]"
if ([string]::IsNullOrWhiteSpace($buildFeYN)) { $buildFeYN = "y" }

$appPort = Read-Host "Enter Server PORT [3000]"
if ([string]::IsNullOrWhiteSpace($appPort)) { $appPort = "3000" }

# 5. Create or Configure .env
Write-Log "Writing configuration to .env file..."
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
}

# Read env content
$envContent = Get-Content ".env" -Raw

# Replace PORT and DEPLOY_MODE
$envContent = $envContent -replace "PORT=\d+", "PORT=$appPort"

if ($buildFeYN -eq "y" -or $buildFeYN -eq "Y") {
    $envContent = $envContent -replace "DEPLOY_MODE=backend-only", "# DEPLOY_MODE=backend-only"
} else {
    $envContent = $envContent -replace "#\s*DEPLOY_MODE=backend-only", "DEPLOY_MODE=backend-only"
    $envContent = $envContent -replace "DEPLOY_MODE=backend-only", "DEPLOY_MODE=backend-only"
}

# Generate random JWT_SECRET if placeholder exists
$defaultSecret = "some_long_random_secret_phrase_for_private_ai_assistant"
if ($envContent -like "*$defaultSecret*") {
    $bytes = New-Object Byte[] 32
    $rand = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rand.GetBytes($bytes)
    $rand.Dispose()
    $newSecret = ($bytes | ForEach-Object { "{0:x2}" -f $_ }) -join ""
    $envContent = $envContent.Replace($defaultSecret, $newSecret)
}

# Save env file
Set-Content -Path ".env" -Value $envContent

# 6. Install Dependencies
Write-Log "Installing NPM dependencies (this might take a few minutes)..."
& npm run install:all

# 7. Database Seeding
Write-Log "Seeding local database..."
$seedCmd = "backend/scripts/seed_settings.js"
& node $seedCmd `
    --username="$adminUser" `
    --password="$adminPass" `
    --device_type="$deviceType" `
    --is_main_host="$isMainHost" `
    --local_url="$localUrl" `
    --local_key="$localKey" `
    --online_key="$onlineKey" `
    --github_token="$githubToken"

# 8. Build Frontend
if ($buildFeYN -eq "y" -or $buildFeYN -eq "Y") {
    Write-Log "Compiling frontend assets..."
    & npm run build
} else {
    Write-Log "Skipped frontend compilation (backend-only deployment mode)."
}

# 9. Register Startup Task
Write-Log "Configuring Windows background service..."
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
    try {
        $taskName = "PrivateAI-Assistant"
        $scriptRoot = Resolve-Path "."
        $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d `"$scriptRoot`" && npm start"
        $trigger = New-ScheduledTaskTrigger -AtLogon
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Private AI Assistant Background Web Server" -Force | Out-Null
        Write-Log "Successfully registered background scheduled task 'PrivateAI-Assistant' to run on Logon." "Green"
    } catch {
        Write-Host "[WARNING] Failed to register background task in Task Scheduler: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n[NOTICE] To automatically launch Private AI on system boot as a background service:" -ForegroundColor Yellow
    Write-Host "Please re-run this setup script in an Administrator PowerShell window." -ForegroundColor Yellow
    Write-Host "Otherwise, you can start the application manually at any time by running 'npm start'." -ForegroundColor Yellow
}

Write-Host "`n====================================================" -ForegroundColor Green
Write-Host "  Setup Completed Successfully!" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
Write-Host "Device Type : $deviceType" -ForegroundColor Green
Write-Host "Main Host   : $isMainHostYN" -ForegroundColor Green
Write-Host "PORT        : $appPort" -ForegroundColor Green
Write-Host "Build UI    : $buildFeYN" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
