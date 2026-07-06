const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const execPromise = util.promisify(exec);
const logger = require('../utils/logger');

class SafeUpdateService {
  constructor() {
    this.activeDir = path.resolve(__dirname, '../..');
    this.stagingDir = path.resolve(this.activeDir, '../private_ai_staging');
    this.repoUrl = 'https://github.com/jjuhric/private_ai.git';
  }

  async checkForUpdates() {
    logger.info('[Safe Update] Checking for updates...');
    try {
      await execPromise('git fetch origin main', { cwd: this.activeDir });
      const { stdout: localHead } = await execPromise('git rev-parse HEAD', { cwd: this.activeDir });
      const { stdout: remoteHead } = await execPromise('git rev-parse origin/main', { cwd: this.activeDir });
      
      const hasUpdate = localHead.trim() !== remoteHead.trim();
      logger.info(`[Safe Update] Has update: ${hasUpdate} (Local: ${localHead.trim().substring(0, 7)} vs Remote: ${remoteHead.trim().substring(0, 7)})`);
      return {
        hasUpdate,
        localHead: localHead.trim(),
        remoteHead: remoteHead.trim()
      };
    } catch (err) {
      logger.error(`[Safe Update] Check updates failed: ${err.message}`);
      return { hasUpdate: false, error: err.message };
    }
  }

  async runUpdatePipeline() {
    logger.info('[Safe Update] Initiating safe update pipeline...');
    try {
      // 1. Prepare Staging
      if (!fs.existsSync(this.stagingDir)) {
        logger.info(`[Safe Update] Creating staging directory by cloning to: ${this.stagingDir}`);
        await execPromise(`git clone "${this.repoUrl}" "${this.stagingDir}"`);
      } else {
        logger.info('[Safe Update] Resetting and pulling in staging...');
        await execPromise('git reset --hard && git checkout main && git pull origin main', { cwd: this.stagingDir });
      }

      // Copy environment configuration to staging for realistic test run
      const activeEnv = path.join(this.activeDir, '.env');
      const stagingEnv = path.join(this.stagingDir, '.env');
      if (fs.existsSync(activeEnv)) {
        fs.copyFileSync(activeEnv, stagingEnv);
      }

      // 2. Install dependencies in Staging
      logger.info('[Safe Update] Installing dependencies in staging...');
      await execPromise('npm install', { cwd: this.stagingDir });
      await execPromise('npm install --prefix backend', { cwd: this.stagingDir });

      // 3. Run validation tests in Staging
      logger.info('[Safe Update] Running validation tests in staging...');
      try {
        await execPromise('npm run test:backend', { cwd: this.stagingDir });
      } catch (testErr) {
        logger.error(`[Safe Update] Tests failed in staging: ${testErr.stdout || testErr.message}`);
        throw new Error(`Validation tests failed in staging branch. Update aborted.`);
      }

      // 4. If staging passed validation, pull in Active directory
      logger.info('[Safe Update] Validation passed! Applying changes to active directory...');
      await execPromise('git pull origin main', { cwd: this.activeDir });
      
      // Update active node_modules if needed
      logger.info('[Safe Update] Re-installing production dependencies in active...');
      await execPromise('npm install --production', { cwd: this.activeDir });
      await execPromise('npm install --prefix backend --production', { cwd: this.activeDir });

      // 5. Trigger service restart
      this.triggerRestart();

      return { success: true, message: 'Update applied. Restarting node now...' };
    } catch (err) {
      logger.error(`[Safe Update] Update pipeline failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  triggerRestart() {
    logger.warn('[Safe Update] Process restarting in 2 seconds...');
    setTimeout(() => {
      // Spawn a detached process that restarts our systemd service or simply exits so pm2/systemd restarts it.
      // On Windows background run-background.vbs will auto-restart it if it exits.
      logger.info('[Safe Update] Process exiting for restart.');
      process.exit(0);
    }, 2000);
  }
}

module.exports = new SafeUpdateService();
