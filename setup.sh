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
echo "     Private AI Assistant Setup & Update Utility    "
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
    log "Node.js is not installed. Installing Node.js (current LTS v20)..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    NODE_VERSION=$(node -v | cut -d'v' -f2)
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
    log "Node.js v$NODE_VERSION is installed."
    if [ "$NODE_MAJOR" -lt 18 ]; then
        log "Node.js version is less than 18. Upgrading Node.js to v20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
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
    
    # Create default .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        log "Creating default .env from .env.example..."
        cp .env.example .env
    fi
fi

# 4. Install Dependencies
log "Installing project dependencies..."
npm run install:all

# 5. Build the Frontend
log "Building frontend application..."
npm run build

# 6. Setup or Restart systemd Service
log "Configuring systemd background service..."

# Resolve path to npm dynamically
NPM_PATH=$(which npm || echo "/usr/bin/npm")

# Create or overwrite systemd service file
log "Creating/updating systemd service file at $SERVICE_FILE..."
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

# 7. Verification
if sudo systemctl is-active --quiet "$SERVICE_NAME".service; then
    log_success "Private AI Assistant is running in the background!"
    log "You can check status using: sudo systemctl status $SERVICE_NAME"
    log "You can check logs using: journalctl -u $SERVICE_NAME -f"
else
    log_error "Failed to start $SERVICE_NAME service. Please check systemctl logs."
fi

echo -e "\nSetup/Update process completed successfully!"
