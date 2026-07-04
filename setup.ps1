[CmdletBinding()]
param (
    [switch]$NonInteractive
)

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

# 4. Load existing defaults from .env and Database
$defaultDeviceType = "windows"
$defaultIsMainHostYN = "y"
$defaultAdminUser = "admin"
$defaultAdminPass = "adminpassword"
$defaultLocalUrl = "http://localhost:1234/v1"
$defaultLocalKey = ""
$defaultOnlineKey = ""
$defaultOnlineProvider = "gemini"
$defaultGithubToken = ""
$defaultBuildFe = "y"
$defaultPort = "3000"
$defaultMainHostIp = "uhrick-home.local"

if (Test-Path ".env") {
    $envLines = Get-Content ".env"
    foreach ($line in $envLines) {
        if ($line -match "^PORT=(.*)") { $defaultPort = $Matches[1].Trim() }
        if ($line -match "^LOCAL_LLM_URL=(.*)") { $defaultLocalUrl = $Matches[1].Trim() }
        if ($line -match "^LOCAL_LLM_KEY=(.*)") { $defaultLocalKey = $Matches[1].Trim() }
        if ($line -match "^GEMINI_API_KEY=(.*)") { $defaultOnlineKey = $Matches[1].Trim() }
        if ($line -match "^GITHUB_TOKEN=(.*)") { $defaultGithubToken = $Matches[1].Trim() }
        if ($line -match "^ONLINE_PROVIDER=(.*)") { $defaultOnlineProvider = $Matches[1].Trim() }
        if ($line -match "^MAIN_HOST_IP=(.*)") { $defaultMainHostIp = $Matches[1].Trim() }
    }
    
    if (Test-Path "backend/node_modules") {
        $dbSettingsJson = & node backend/scripts/read_settings.js *>$null
        if ($dbSettingsJson -and $dbSettingsJson -ne "{}") {
            try {
                $dbSettings = ConvertFrom-Json $dbSettingsJson
                if ($dbSettings.username) { $defaultAdminUser = $dbSettings.username }
                if ($dbSettings.device_type) { $defaultDeviceType = $dbSettings.device_type }
                if ($dbSettings.is_main_host -eq 0) { $defaultIsMainHostYN = "n" }
                if ($dbSettings.local_url) { $defaultLocalUrl = $dbSettings.local_url }
                if ($dbSettings.local_key) { $defaultLocalKey = $dbSettings.local_key }
                if ($dbSettings.online_provider) { $defaultOnlineProvider = $dbSettings.online_provider }
                if ($dbSettings.online_key) { $defaultOnlineKey = $dbSettings.online_key }
                if ($dbSettings.github_token) { $defaultGithubToken = $dbSettings.github_token }
            } catch {}
        }
    }
}

# 5. Configuration Settings
if ($NonInteractive) {
    Write-Log "Running in non-interactive mode. Utilizing configuration defaults." "Yellow"
    $deviceType = $defaultDeviceType
    $isMainHost = if ($defaultIsMainHostYN -eq "y") { "1" } else { "0" }
    $mainHostIp = $defaultMainHostIp
    $adminUser = $defaultAdminUser
    $adminPass = $defaultAdminPass
    $localUrl = $defaultLocalUrl
    $localKey = $defaultLocalKey
    $onlineKey = $defaultOnlineKey
    $githubToken = $defaultGithubToken
    $buildFeYN = "y"
    $appPort = $defaultPort
} else {
    Write-Host "`n====================================================" -ForegroundColor Cyan
    Write-Host "  Configuration Settings" -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor Cyan

    $deviceType = Read-Host "Enter Device Type (windows, linux, rpi-5-8gb, rpi-5-16gb, rpi-zero-2w, esp32) [$defaultDeviceType]"
    if ([string]::IsNullOrWhiteSpace($deviceType)) { $deviceType = $defaultDeviceType }

    $isMainHostYN = Read-Host "Should this node act as a Main Host (runs LLMs, chat UI, etc)? (y/n) [$defaultIsMainHostYN]"
    if ([string]::IsNullOrWhiteSpace($isMainHostYN)) { $isMainHostYN = $defaultIsMainHostYN }
    $isMainHost = "0"
    if ($isMainHostYN -eq "y" -or $isMainHostYN -eq "Y") {
        $isMainHost = "1"
    }

    $mainHostIp = ""
    if ($isMainHost -eq "0") {
        $mainHostIp = Read-Host "Enter Main Host IP address (optional) [$defaultMainHostIp]"
        if ([string]::IsNullOrWhiteSpace($mainHostIp)) { $mainHostIp = $defaultMainHostIp }
    }

    $adminUser = Read-Host "Enter Admin Username [$defaultAdminUser]"
    if ([string]::IsNullOrWhiteSpace($adminUser)) { $adminUser = $defaultAdminUser }

    $adminPass = Read-Host "Enter Admin Password [$defaultAdminPass]"
    if ([string]::IsNullOrWhiteSpace($adminPass)) { $adminPass = $defaultAdminPass }

    $localUrl = Read-Host "Enter Local LLM Base URL [$defaultLocalUrl]"
    if ([string]::IsNullOrWhiteSpace($localUrl)) { $localUrl = $defaultLocalUrl }

    $localKey = Read-Host "Enter Local LLM API Key (optional) [$defaultLocalKey]"
    if ([string]::IsNullOrWhiteSpace($localKey)) { $localKey = $defaultLocalKey }

    $onlineKey = Read-Host "Enter Online Gemini API Key (optional) [$defaultOnlineKey]"
    if ([string]::IsNullOrWhiteSpace($onlineKey)) { $onlineKey = $defaultOnlineKey }

    $githubToken = Read-Host "Enter GitHub Access Token (optional) [$defaultGithubToken]"
    if ([string]::IsNullOrWhiteSpace($githubToken)) { $githubToken = $defaultGithubToken }

    $buildFeYN = Read-Host "Build React Frontend on this node? (y/n) [y]"
    if ([string]::IsNullOrWhiteSpace($buildFeYN)) { $buildFeYN = "y" }

    $appPort = Read-Host "Enter Server PORT [$defaultPort]"
    if ([string]::IsNullOrWhiteSpace($appPort)) { $appPort = $defaultPort }
}

# 6. Create or Configure .env
Write-Log "Writing configuration to .env file..."
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
}

# 6. Create or Configure .env
Write-Log "Writing configuration to .env file..."
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
}

# Helper to write/update key-value pair in .env
function Write-EnvVar ($Key, $Val) {
    $envPath = ".env"
    $lines = Get-Content $envPath
    $found = $false
    for ($i=0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -match "^$Key=") {
            $lines[$i] = "$Key=$Val"
            $found = $true
            break
        }
    }
    if (-not $found) {
        $lines += "$Key=$Val"
    }
    Set-Content -Path $envPath -Value $lines
}

Write-EnvVar "PORT" $appPort
Write-EnvVar "LOCAL_LLM_URL" $localUrl
Write-EnvVar "LOCAL_LLM_KEY" $localKey
Write-EnvVar "GEMINI_API_KEY" $onlineKey
Write-EnvVar "GITHUB_TOKEN" $githubToken
Write-EnvVar "PREFERRED_LOCAL_MODEL" "qwen/qwen3.5-9b"
Write-EnvVar "PREFERRED_ONLINE_MODEL" "gemini-2.0-flash"
Write-EnvVar "SUPERVISOR_MODEL" "gemini-1.5-pro"
if ($isMainHost -eq "0") {
    Write-EnvVar "MAIN_HOST_IP" $mainHostIp
}

# Read env content
$envContent = Get-Content ".env" -Raw

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

# 7. Install Dependencies
Write-Log "Installing NPM dependencies (this might take a few minutes)..."
& npm run install:all

# 8. Database Seeding
$resetDb = $false
if (-not $NonInteractive) {
    $resetDbYN = Read-Host "Do you want to reset the database and start fresh (deletes all users)? (y/n) [n]"
    if ($resetDbYN -eq "y" -or $resetDbYN -eq "Y") {
        $resetDb = $true
    }
}

if ($resetDb) {
    Write-Log "Wiping existing database for a fresh setup..." "Yellow"
    $dbPath = "backend/database.db"
    foreach ($suffix in ("", "-wal", "-shm")) {
        $file = $dbPath + $suffix
        if (Test-Path $file) {
            Remove-Item $file -Force -ErrorAction SilentlyContinue
        }
    }
}

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
    --github_token="$githubToken" `
    --online_provider="$defaultOnlineProvider"

# 9. Build Frontend
if ($buildFeYN -eq "y" -or $buildFeYN -eq "Y") {
    Write-Log "Compiling frontend assets..."
    & npm run build
} else {
    Write-Log "Skipped frontend compilation (backend-only deployment mode)."
}

# 10. Register Startup Task
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
Write-Host "Main Host   : $isMainHost" -ForegroundColor Green
Write-Host "PORT        : $appPort" -ForegroundColor Green
Write-Host "Build UI    : $buildFeYN" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
