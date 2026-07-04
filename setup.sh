#!/bin/bash

# Exit on error
set -e

# Configuration
REPO_URL="https://github.com/jjuhric/private_ai.git"
TARGET_PARENT_DIR="$HOME/Documents"
TARGET_DIR="$TARGET_PARENT_DIR/private_ai"
SERVICE_NAME="private-ai"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "===================================================="
echo "  Private AI Assistant Setup & Update Utility V4.0.0 "
echo "===================================================="

# Helper function to print logs
log() {
    echo -e "\n[INFO] $1"
}

log_success() {
    echo -e "\n[SUCCESS] $1"
}

log_error() {
    echo -e "\n[ERROR] $1" >&2
}

# 1. Determine if we are already inside a git clone of this repository
if [ -d ".git" ] && grep -q "private-ai-assistant" package.json 2>/dev/null; then
    TARGET_DIR="$(pwd)"
    TARGET_PARENT_DIR="$(dirname "$TARGET_DIR")"
    log "Detected execution from inside existing clone: $TARGET_DIR"
fi

# 2. Check and install system prerequisites if needed
log "Checking system prerequisites..."

# Verify Git
if ! command -v git &> /dev/null; then
    log "Git is not installed. Installing..."
    sudo apt-get update && sudo apt-get install -y git
else
    log "Git is installed."
fi

# Verify Node.js
if ! command -v node &> /dev/null; then
    log "Node.js is not installed. Installing Node.js (v25)..."
    curl -fsSL https://deb.nodesource.com/setup_25.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    NODE_VERSION=$(node -v | cut -d'v' -f2)
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
    log "Node.js v$NODE_VERSION is installed."
    if [ "$NODE_MAJOR" -lt 25 ]; then
        log "Node.js version is less than 25. Upgrading Node.js to v25..."
        curl -fsSL https://deb.nodesource.com/setup_25.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
fi

# 3. Clone or Update the Project
if [ -d "$TARGET_DIR" ]; then
    log "Project directory exists at $TARGET_DIR. Performing update..."
    cd "$TARGET_DIR"
    
    log "Pulling latest updates from Github..."
    git pull
else
    log "Project directory does not exist at $TARGET_DIR. Performing clean setup..."
    mkdir -p "$TARGET_PARENT_DIR"
    cd "$TARGET_PARENT_DIR"
    
    log "Cloning repository from $REPO_URL..."
    git clone "$REPO_URL"
    
    cd "$TARGET_DIR"
fi

# 4. Interactive Configuration
echo -e "\n===================================================="
echo "  Configuration Settings"
echo "===================================================="

# Device Type selection
echo "Supported Device Types:"
echo "  1) Windows"
echo "  2) General Linux (default)"
echo "  3) Raspberry Pi 5 (8GB)"
echo "  4) Raspberry Pi 5 (15GB/16GB)"
echo "  5) Raspberry Pi 4"
echo "  6) Raspberry Pi Zero 2W"
echo "  7) ESP32 Node"
read -p "Select your device type [2]: " DEV_CHOICE
case $DEV_CHOICE in
    1) DEVICE_TYPE="windows" ;;
    2|*) DEVICE_TYPE="linux" ;;
    3) DEVICE_TYPE="rpi-5-8gb" ;;
    4) DEVICE_TYPE="rpi-5-15gb" ;;
    5) DEVICE_TYPE="rpi-4b-2gb" ;;
    6) DEVICE_TYPE="rpi-zero-2w" ;;
    7) DEVICE_TYPE="esp32" ;;
esac

# Main Host role prompt
read -p "Should this node act as a Main Host (runs LLMs, chat UI, etc)? (y/n) [y]: " MAIN_HOST_YN
MAIN_HOST_YN=${MAIN_HOST_YN:-y}
if [[ "$MAIN_HOST_YN" =~ ^[Yy]$ ]]; then
    IS_MAIN_HOST="1"
else
    IS_MAIN_HOST="0"
fi

# Admin account registration
read -p "Enter Admin Username [admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}

read -p "Enter Admin Password [adminpassword]: " ADMIN_PASS
ADMIN_PASS=${ADMIN_PASS:-adminpassword}

# Local LLM address
read -p "Enter Local LLM Base URL [http://localhost:1234/v1]: " LOCAL_URL
LOCAL_URL=${LOCAL_URL:-http://localhost:1234/v1}

# Optional API Keys / Tokens
read -p "Enter Local LLM API Key (optional): " LOCAL_KEY
read -p "Enter Online Gemini API Key (optional): " ONLINE_KEY
read -p "Enter GitHub Access Token (optional): " GITHUB_TOKEN

# Deployment mode / Frontend compilation check
read -p "Build React Frontend on this node? (y/n) [y]: " BUILD_FE_YN
BUILD_FE_YN=${BUILD_FE_YN:-y}

# Server port configuration
read -p "Enter Server PORT [3000]: " APP_PORT
APP_PORT=${APP_PORT:-3000}

# Create .env config file
log "Configuring environment variables (.env)..."
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

# Write PORT and DEPLOY_MODE into .env
sed -i "s/^PORT=.*/PORT=${APP_PORT}/" .env || echo "PORT=${APP_PORT}" >> .env

if [[ "$BUILD_FE_YN" =~ ^[Yy]$ ]]; then
    sed -i "s/^DEPLOY_MODE=.*/# DEPLOY_MODE=backend-only/" .env
    DEPLOY_MODE=""
else
    if grep -q "DEPLOY_MODE" .env; then
        sed -i "s/^#\?\s*DEPLOY_MODE=.*/DEPLOY_MODE=backend-only/" .env
    else
        echo "DEPLOY_MODE=backend-only" >> .env
    fi
    DEPLOY_MODE="backend-only"
fi

# Generate random JWT_SECRET if it matches the default placeholder
DEFAULT_SECRET="some_long_random_secret_phrase_for_private_ai_assistant"
if grep -q "$DEFAULT_SECRET" .env; then
    NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    sed -i "s/$DEFAULT_SECRET/$NEW_SECRET/" .env
fi

# 5. Install Dependencies
log "Installing project dependencies (this may take a few minutes)..."
npm run install:all

# 6. Database Initialization & Seeding
log "Initializing database and seeding configuration..."
node backend/scripts/seed_settings.js \
    --username="$ADMIN_USER" \
    --password="$ADMIN_PASS" \
    --device_type="$DEVICE_TYPE" \
    --is_main_host="$IS_MAIN_HOST" \
    --local_url="$LOCAL_URL" \
    --local_key="$LOCAL_KEY" \
    --online_key="$ONLINE_KEY" \
    --github_token="$GITHUB_TOKEN"

# 7. Build Frontend (if requested)
if [[ "$BUILD_FE_YN" =~ ^[Yy]$ ]]; then
    log "Building frontend application..."
    npm run build
else
    log "Skipping frontend compilation (backend-only deployment)."
fi

# 8. Setup systemd Service (if not Windows/ESP32 choice)
if [ "$DEVICE_TYPE" != "windows" ] && [ "$DEVICE_TYPE" != "esp32" ]; then
    log "Configuring systemd background service..."
    NPM_PATH=$(which npm || echo "/usr/bin/npm")

    # Create or overwrite systemd service file
    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Private AI Assistant Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$TARGET_DIR
ExecStart=$NPM_PATH start
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    log "Reloading systemd daemon..."
    sudo systemctl daemon-reload

    log "Enabling $SERVICE_NAME service to start on boot..."
    sudo systemctl enable "$SERVICE_NAME".service

    log "Restarting $SERVICE_NAME service..."
    sudo systemctl restart "$SERVICE_NAME".service

    # Verify status
    if sudo systemctl is-active --quiet "$SERVICE_NAME".service; then
        log_success "Private AI Assistant is running in the background!"
        log "Check status: sudo systemctl status $SERVICE_NAME"
        log "Check logs: journalctl -u $SERVICE_NAME -f"
    else
        log_error "Failed to start $SERVICE_NAME service. Please check systemctl logs."
    fi
fi

echo -e "\n===================================================="
echo "  Setup Completed Successfully!"
echo "===================================================="
echo "Device Type : $DEVICE_TYPE"
echo "Main Host   : $MAIN_HOST_YN"
echo "Port        : $APP_PORT"
echo "Build UI    : $BUILD_FE_YN"
echo "===================================================="
