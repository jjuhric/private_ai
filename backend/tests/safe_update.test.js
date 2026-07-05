jest.mock('child_process', () => {
  const mockExec = jest.fn();
  const mockExecPromise = jest.fn();
  mockExec[Symbol.for('nodejs.util.promisify.custom')] = mockExecPromise;
  return { exec: mockExec };
});

jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    existsSync: jest.fn(),
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
      } else if (cmd.includes('rev-parse origin/main')) {
        return { stdout: 'remote_sha_456\n', stderr: '' };
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

  test('should execute full staging pull and test runner workflow', async () => {
    fs.existsSync.mockReturnValue(true); // staging folder exists
    mockExecPromise.mockResolvedValue({ stdout: 'success stdout', stderr: '' });

    // Mock restart trigger
    jest.useFakeTimers();
    const res = await safeUpdateService.runUpdatePipeline();
    expect(res.success).toBe(true);

    expect(mockExecPromise).toHaveBeenCalledWith(expect.stringContaining('git reset --hard'), expect.any(Object));
    expect(mockExecPromise).toHaveBeenCalledWith(expect.stringContaining('npm run test:backend'), expect.any(Object));
    expect(mockExecPromise).toHaveBeenCalledWith(expect.stringContaining('git pull origin main'), expect.any(Object));

    // Check restart trigger
    jest.advanceTimersByTime(2000);
    expect(process.exit).toHaveBeenCalledWith(0);
    jest.useRealTimers();
  });
});
