const cron = require('node-cron');
const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const logger = require('../utils/logger');

const execPromise = util.promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

async function checkForUpdates() {
  try {
    logger.info('[Auto-Updater] Checking for updates on GitHub...');

    // 1. Fetch latest changes from origin
    await execPromise('git', ['fetch', 'origin'], { cwd: PROJECT_ROOT });

    // 2. Check if local main is behind origin/main
    // Rev-list counts how many commits origin/main is ahead of local HEAD
    const { stdout } = await execPromise('git', ['rev-list', 'HEAD..origin/main', '--count'], { cwd: PROJECT_ROOT });
    const commitsBehind = parseInt(stdout.trim(), 10);

    if (commitsBehind > 0) {
      logger.info(`[Auto-Updater] Update found! Behind by ${commitsBehind} commit(s). Initiating update...`);

      // 3. Pull updates
      await execPromise('git', ['pull', 'origin', 'main'], { cwd: PROJECT_ROOT });
      logger.info('[Auto-Updater] Successfully pulled latest code.');

      // 4. Install dependencies (backend)
      logger.info('[Auto-Updater] Installing backend dependencies...');
      await execPromise('npm', ['install'], { cwd: path.join(PROJECT_ROOT, 'backend') });

      // 5. Install dependencies (frontend)
      const frontendPath = path.join(PROJECT_ROOT, 'frontend');
      const fs = require('fs');
      if (fs.existsSync(frontendPath)) {
        logger.info('[Auto-Updater] Installing frontend dependencies...');
        await execPromise('npm', ['install'], { cwd: frontendPath });
      }
      
      // 6. Install dependencies (node_client)
      const nodeClientPath = path.join(PROJECT_ROOT, 'node_client');
      if (fs.existsSync(nodeClientPath)) {
        logger.info('[Auto-Updater] Installing node_client dependencies...');
        await execPromise('npm', ['install'], { cwd: nodeClientPath });
      }

      logger.info('[Auto-Updater] Update complete. Gracefully restarting the application...');
      
      // Graceful shutdown
      // Process manager (PM2/systemd) is expected to restart the application automatically on exit
      process.exit(0);
    } else {
      logger.info('[Auto-Updater] System is up to date. No update required.');
    }
  } catch (err) {
    logger.error(`[Auto-Updater] Error during update check: ${err.message}`, { stack: err.stack });
  }
}

function startHostAutoUpdater() {
  // Check on startup
  setTimeout(() => {
    checkForUpdates();
  }, 10000); // delay 10s on startup to let server initialize

  // Check every hour at minute 0
  cron.schedule('0 * * * *', () => {
    checkForUpdates();
  });
  
  logger.info('[Auto-Updater] Daemon started, scheduled to check for updates every hour.');
}

module.exports = { startHostAutoUpdater, checkForUpdates };
