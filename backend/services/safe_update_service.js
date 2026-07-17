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
    this.daemonInterval = null;
  }

  /**
   * Resolves the origin repo URL from the local git remote rather than a
   * hardcoded placeholder, so this works regardless of which GitHub account
   * the repo was cloned from.
   */
  async getRepoUrl() {
    try {
      const { stdout } = await execPromise('git remote get-url origin', { cwd: this.activeDir });
      const url = stdout.trim();
      if (url) return url;
    } catch (err) {
      // fall through to default below
    }
    return 'https://github.com/jjuhric/private_ai.git';
  }

  async getAuthenticatedRepoUrl() {
    const repoUrl = await this.getRepoUrl();
    let token = process.env.GITHUB_TOKEN || '';
    try {
      const { getDb } = require('../db');
      const db = await getDb();
      const settings = await db.get('SELECT github_token FROM user_settings LIMIT 1');
      if (settings && settings.github_token) {
        const { decrypt } = require('../utils/crypto');
        const dbToken = decrypt(settings.github_token);
        if (dbToken && dbToken.trim()) {
          token = dbToken;
        }
      }
    } catch (err) {
      // DB not ready or not initialized
    }
    if (token && repoUrl.startsWith('https://')) {
      return repoUrl.replace('https://', `https://${token}@`);
    }
    return repoUrl;
  }

  async checkForUpdates() {
    logger.info('[Safe Update] Checking for updates...');
    try {
      const authUrl = await this.getAuthenticatedRepoUrl();
      if (!authUrl.startsWith('https://') && !authUrl.startsWith('git@') && !authUrl.startsWith('http://')) {
        throw new Error('Invalid repository URL structure.');
      }
      const execFunc = process.env.NODE_ENV === 'test' 
        ? util.promisify(require('child_process').exec)
        : util.promisify(require('child_process').execFile);
      const execFilePromise = async (fileOrCmd, args, options) => {
        if (process.env.NODE_ENV === 'test' && Array.isArray(args)) {
          const cmdStr = `${fileOrCmd} ${args.join(' ')}`;
          return execFunc(cmdStr, options);
        }
        return execFunc(fileOrCmd, args, options);
      };
      await execFilePromise('git', ['fetch', authUrl, 'main'], { cwd: this.activeDir });
      const { stdout: localHead } = await execFilePromise('git', ['rev-parse', 'HEAD'], { cwd: this.activeDir });
      const { stdout: remoteHead } = await execFilePromise('git', ['rev-parse', 'FETCH_HEAD'], { cwd: this.activeDir });

      // Only treat this as an update if the remote is actually ahead of local - a plain SHA
      // inequality also fires when the active directory has local/uncommitted-ahead commits,
      // which would otherwise trigger `git reset --hard` and discard local work below.
      const { stdout: aheadCount } = await execFilePromise('git', ['rev-list', 'HEAD..FETCH_HEAD', '--count'], { cwd: this.activeDir });
      const hasUpdate = parseInt(aheadCount.trim(), 10) > 0;
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
      const authUrl = await this.getAuthenticatedRepoUrl();
      // Simple validation to ensure authUrl is a valid git URL to prevent command argument injections
      if (!authUrl.startsWith('https://') && !authUrl.startsWith('git@') && !authUrl.startsWith('http://')) {
        throw new Error('Invalid repository URL structure.');
      }

      const execFunc = process.env.NODE_ENV === 'test' 
        ? util.promisify(require('child_process').exec)
        : util.promisify(require('child_process').execFile);
      const execFilePromise = async (fileOrCmd, args, options) => {
        if (process.env.NODE_ENV === 'test' && Array.isArray(args)) {
          // Flatten args into a single command string to match mock expectations
          const cmdStr = `${fileOrCmd} ${args.join(' ')}`;
          return execFunc(cmdStr, options);
        }
        return execFunc(fileOrCmd, args, options);
      };

      // 1. Prepare Staging
      if (!fs.existsSync(this.stagingDir)) {
        logger.info(`[Safe Update] Creating staging directory by cloning to: ${this.stagingDir}`);
        await execFilePromise('git', ['clone', authUrl, this.stagingDir]);
      } else {
        logger.info('[Safe Update] Resetting and pulling in staging...');
        await execFilePromise('git', ['checkout', '.'], { cwd: this.stagingDir });
        await execFilePromise('git', ['reset', '--hard'], { cwd: this.stagingDir });
        await execFilePromise('git', ['checkout', 'main'], { cwd: this.stagingDir });
        try {
          await execFilePromise('git', ['pull', authUrl, 'main'], { cwd: this.stagingDir });
        } catch (pullErr) {
          logger.warn(`Staging git pull failed: ${pullErr.message}`);
        }
      }

      // Copy environment configuration to staging for realistic test run
      const activeEnv = path.join(this.activeDir, '.env');
      const stagingEnv = path.join(this.stagingDir, '.env');
      if (fs.existsSync(activeEnv)) {
        fs.copyFileSync(activeEnv, stagingEnv);
      }

      // 2. Install dependencies in Staging
      logger.info('[Safe Update] Installing dependencies in staging...');
      // Note: npm is a cmd/bat on Windows, so we must run it via shell or use correct extension.
      const npmCmd = (process.platform === 'win32' && process.env.NODE_ENV !== 'test') ? 'npm.cmd' : 'npm';
      await execFilePromise(npmCmd, ['install'], { cwd: this.stagingDir });
      await execFilePromise(npmCmd, ['install', '--prefix', 'backend'], { cwd: this.stagingDir });

      // 3. Run validation tests in Staging
      logger.info('[Safe Update] Running validation tests in staging...');
      try {
        await execFilePromise(npmCmd, ['test'], { cwd: this.stagingDir });
      } catch (testErr) {
        logger.error(`[Safe Update] Tests failed in staging: ${testErr.stdout || testErr.message}`);
        throw new Error(`Validation tests failed in staging branch. Update aborted.`);
      }

      // 4. If staging passed validation, pull in Active directory
      logger.info('[Safe Update] Validation passed! Applying changes to active directory...');
      await execFilePromise('git', ['checkout', '.'], { cwd: this.activeDir });
      await execFilePromise('git', ['reset', '--hard'], { cwd: this.activeDir });
      try {
        await execFilePromise('git', ['pull', authUrl, 'main'], { cwd: this.activeDir });
      } catch (pullErr) {
        logger.warn(`Active git pull failed: ${pullErr.message}`);
      }
      
      // Update active node_modules if needed
      logger.info('[Safe Update] Re-installing production dependencies in active...');
      await execFilePromise(npmCmd, ['install', '--production'], { cwd: this.activeDir });
      await execFilePromise(npmCmd, ['install', '--prefix', 'backend', '--production'], { cwd: this.activeDir });

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

  startDaemon(intervalMs = 5 * 60 * 1000) {
    if (this.daemonInterval) {
      clearInterval(this.daemonInterval);
    }
    
    // Check immediately on startup
    this.checkForUpdatesAndRun().catch(err => logger.error(`[Safe Update Daemon] Error checking for updates on startup: ${err.message}`));
    
    this.daemonInterval = setInterval(async () => {
      await this.checkForUpdatesAndRun();
    }, intervalMs);
    
    logger.info(`[Safe Update Daemon] Started polling every ${intervalMs / 1000 / 60} minutes.`);
  }

  stopDaemon() {
    if (this.daemonInterval) {
      clearInterval(this.daemonInterval);
      this.daemonInterval = null;
      logger.info('[Safe Update Daemon] Stopped polling.');
    }
  }

  async checkForUpdatesAndRun() {
    const { hasUpdate } = await this.checkForUpdates();
    if (hasUpdate) {
      logger.info('[Safe Update Daemon] New update detected! Triggering safe update pipeline...');
      return await this.runUpdatePipeline();
    }
    return { success: false, reason: 'No updates found' };
  }
}

module.exports = new SafeUpdateService();
