const { handleNetworkScanner } = require('../tools/network_scanner');

describe('Network Scanner Tool tests', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('unknown action returns error message', async () => {
    const res = await handleNetworkScanner('unknown_action');
    expect(res).toContain('Error: Unknown action');
  });

  test('valid scan action with subnet parses parameter successfully', async () => {
    // Mock mDnsSd and child_process execution to run test without actual network queries
    jest.mock('node-dns-sd', () => ({
      discover: jest.fn(() => [])
    }));
    
    // Simple mock check
    const res = await handleNetworkScanner('scan_network', { subnet: '192.168.1.1' });
    expect(res).toContain('Network Scan Report');
    expect(res).toContain('192.168.1.0/24');
  });
});
