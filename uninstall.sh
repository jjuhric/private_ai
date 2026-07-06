#!/bin/bash

# Uninstall script for Private AI Assistant
# Removes systemd service, cron jobs, environment configurations, logs, databases, and dependencies

echo "============================================="
echo "❌ Uninstalling Private AI Assistant Node"
echo "============================================="

# 1. Stop and disable systemd service if running
SERVICE_NAME="private-ai"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ -f "$SERVICE_FILE" ]; then
    echo "Stopping and disabling systemd service..."
    sudo systemctl stop "$SERVICE_NAME".service 2>/dev/null
    sudo systemctl disable "$SERVICE_NAME".service 2>/dev/null
    sudo rm -f "$SERVICE_FILE"
    sudo systemctl daemon-reload
    echo "✅ Systemd service removed."
fi

# 2. Remove cron job autoupdate entry
if command -v crontab &> /dev/null; then
    echo "Removing autoupdate task from cron..."
    crontab -l 2>/dev/null | grep -v "setup.sh --non-interactive" | crontab - 2>/dev/null
    echo "✅ Autoupdate cron job removed."
fi

# 3. Clean environment files, logs, and database files
echo "Deleting logs, databases, and local staging directories..."
rm -f .env
rm -f app.log
rm -rf tool_registry/staging
rm -rf tool_registry/tools

# Resolve database path from .env if possible, otherwise use default
DB_FILE="backend/database.db"
rm -f "$DB_FILE" "${DB_FILE}-wal" "${DB_FILE}-shm"
rm -f "backend/test_database.db" "backend/test_database.db-wal" "backend/test_database.db-shm"
echo "✅ Configuration, logs, and database files removed."

# 4. Remove dependencies and built files
echo "Deleting node_modules directories and compiled build assets..."
rm -rf node_modules backend/node_modules frontend/node_modules
rm -rf frontend/dist
echo "✅ Dependencies and frontend assets cleaned."

echo "============================================="
echo "🎉 Private AI has been uninstalled successfully!"
echo "============================================="
