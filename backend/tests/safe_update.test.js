jest.mock('child_process', () => {
  const mockExec = jest.fn();
  const mockExecPromise = jest.fn();
  mockExec[Symbol.for('nodejs.util.promisify.custom')] = mockExecPromise;
  return { exec: mockExec };
});

jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  const mockExistsSync = jest.fn((pathStr) => {
    // If checking path relating to staging dir
    if (typeof pathStr === 'string' && (pathStr.includes('private_ai_staging') || pathStr.includes('.env'))) {
      return false; 
    }
    return originalFs.existsSync(pathStr);
  });
  return {
    ...originalFs,
    existsSync: mockExistsSync,
    copyFileSync: jest.fn()
  };
});

const safeUpdateService = require('../services/safe_update_service');
const { exec } = require('child_process');
const fs = require('fs');

const mockExecPromise = exec[Symbol.for('nodejs.util.promisify.custom')];

describe('Safe Update Service Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'exit').mockImplementation(() => {});
  });

  test('should return true for update available', async () => {
    mockExecPromise.mockImplementation(async (cmd) => {
      if (cmd.includes('rev-parse HEAD')) {
        return { stdout: 'local_sha_123\n', stderr: '' };
      } else if (cmd.includes('rev-parse FETCH_HEAD')) {
        return { stdout: 'remote_sha_456\n', stderr: '' };
      } else if (cmd.includes('rev-list HEAD..FETCH_HEAD')) {
        return { stdout: '3\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const info = await safeUpdateService.checkForUpdates();
    expect(info.hasUpdate).toBe(true);
    expect(info.localHead).toBe('local_sha_123');
    expect(info.remoteHead).toBe('remote_sha_456');
  });

  test('should return false if shas are equal', async () => {
    mockExecPromise.mockResolvedValue({ stdout: 'same_sha\n', stderr: '' });

    const info = await safeUpdateService.checkForUpdates();
    expect(info.hasUpdate).toBe(false);
  });

  test('should return false if local is ahead of remote (no remote-only commits)', async () => {
    mockExecPromise.mockImplementation(async (cmd) => {
      if (cmd.includes('rev-parse HEAD')) {
        return { stdout: 'local_sha_ahead\n', stderr: '' };
      } else if (cmd.includes('rev-parse FETCH_HEAD')) {
        return { stdout: 'remote_sha_old\n', stderr: '' };
      } else if (cmd.includes('rev-list HEAD..FETCH_HEAD')) {
        return { stdout: '0\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const info = await safeUpdateService.checkForUpdates();
    expect(info.hasUpdate).toBe(false);
  });

  test('should execute full staging pull and test runner workflow', async () => {
    fs.existsSync.mockReturnValue(true); // staging folder exists
    mockExecPromise.mockImplementation(async (cmd) => {
      if (cmd.includes('remote get-url origin')) {
        return { stdout: 'https://github.com/jjuhric/private_ai.git\n', stderr: '' };
      }
      return { stdout: 'success stdout', stderr: '' };
    });

    // Mock restart trigger
    jest.useFakeTimers();
    const res = await safeUpdateService.runUpdatePipeline();
    expect(res.success).toBe(true);

    expect(mockExecPromise).toHaveBeenCalledWith(expect.stringContaining('git reset --hard'), expect.any(Object));
    expect(mockExecPromise).toHaveBeenCalledWith(expect.stringContaining('npm test'), expect.any(Object));
    expect(mockExecPromise).toHaveBeenCalledWith(expect.stringContaining('git pull'), expect.any(Object));

    // Check restart trigger
    jest.advanceTimersByTime(2000);
    expect(process.exit).toHaveBeenCalledWith(0);
    jest.useRealTimers();
  });

  describe('Automatic Check Daemon Tests', () => {
    let originalCheckForUpdatesAndRun;

    beforeEach(() => {
      originalCheckForUpdatesAndRun = safeUpdateService.checkForUpdatesAndRun;
      safeUpdateService.checkForUpdatesAndRun = jest.fn().mockResolvedValue({ success: true });
      jest.useFakeTimers();
    });

    afterEach(() => {
      safeUpdateService.checkForUpdatesAndRun = originalCheckForUpdatesAndRun;
      safeUpdateService.stopDaemon();
      jest.useRealTimers();
    });

    test('startDaemon starts interval and calls checkForUpdatesAndRun immediately and on tick', async () => {
      safeUpdateService.startDaemon(1000);
      expect(safeUpdateService.checkForUpdatesAndRun).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1000);
      expect(safeUpdateService.checkForUpdatesAndRun).toHaveBeenCalledTimes(2);
    });

    test('stopDaemon clears interval and stops polling', async () => {
      safeUpdateService.startDaemon(1000);
      expect(safeUpdateService.checkForUpdatesAndRun).toHaveBeenCalledTimes(1);

      safeUpdateService.stopDaemon();
      jest.advanceTimersByTime(1000);
      expect(safeUpdateService.checkForUpdatesAndRun).toHaveBeenCalledTimes(1);
    });

    test('checkForUpdatesAndRun runs update pipeline if update is available', async () => {
      jest.spyOn(safeUpdateService, 'checkForUpdates').mockResolvedValue({ hasUpdate: true });
      jest.spyOn(safeUpdateService, 'runUpdatePipeline').mockResolvedValue({ success: true });

      const res = await originalCheckForUpdatesAndRun.call(safeUpdateService);
      expect(res.success).toBe(true);
      expect(safeUpdateService.runUpdatePipeline).toHaveBeenCalled();
    });

    test('checkForUpdatesAndRun does not run update pipeline if no update is available', async () => {
      jest.spyOn(safeUpdateService, 'checkForUpdates').mockResolvedValue({ hasUpdate: false });
      jest.spyOn(safeUpdateService, 'runUpdatePipeline').mockResolvedValue({ success: true });

      const res = await originalCheckForUpdatesAndRun.call(safeUpdateService);
      expect(res.success).toBe(false);
      expect(safeUpdateService.runUpdatePipeline).not.toHaveBeenCalled();
    });
  });
});
