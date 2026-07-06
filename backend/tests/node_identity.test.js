const nodeIdentity = require('../services/node_identity');
const { getDb } = require('../db');
const os = require('os');

jest.mock('../db', () => ({
  getDb: jest.fn()
}));

jest.mock('../services/tool_manager', () => ({
  getInstalledTools: jest.fn().mockResolvedValue([{ tool_name: 'test_tool' }])
}));

describe('Node Identity Service Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nodeIdentity.clearCache();
  });

  test('should return correct identity payload', async () => {
    const mockDb = {
      get: jest.fn().mockResolvedValue({ device_type: 'rpi5', is_main_host: 0 })
    };
    getDb.mockResolvedValue(mockDb);

    // Spy on os module
    jest.spyOn(os, 'type').mockReturnValue('Linux');
    jest.spyOn(os, 'arch').mockReturnValue('arm64');
    jest.spyOn(os, 'hostname').mockReturnValue('rpi5-lr');
    jest.spyOn(os, 'totalmem').mockReturnValue(8192 * 1024 * 1024);
    jest.spyOn(os, 'cpus').mockReturnValue([{ model: 'Cortex-A76' }]);

    const identity = await nodeIdentity.getIdentity();

    expect(identity.nodeId).toBe('rpi5-field');
    expect(identity.os).toBe('Linux');
    expect(identity.arch).toBe('arm64');
    expect(identity.hostname).toBe('rpi5-lr');
    expect(identity.totalMemoryMB).toBe(8192);
    expect(identity.installedTools).toContain('test_tool');
    expect(identity.cores).toBe(1);
    expect(identity.cpuModel).toBe('Cortex-A76');
  });
});
