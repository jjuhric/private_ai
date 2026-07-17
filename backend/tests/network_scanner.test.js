// Mock net.Socket so tests never perform a real TCP sweep of the actual local subnet
// (the previous version of this test scanned the real 192.168.1.0/24 network and wrote
// the results into the live database.db on every `npm test` run).
jest.mock('net', () => ({
  Socket: jest.fn().mockImplementation(() => {
    const listeners = {};
    return {
      setTimeout: jest.fn(),
      destroy: jest.fn(),
      connect: jest.fn().mockImplementation(() => {
        if (listeners['timeout']) listeners['timeout']();
      }),
      on: jest.fn().mockImplementation((event, callback) => {
        listeners[event] = callback;
      })
    };
  })
}));

// Mock the ARP lookup (child_process.exec) so no real system command runs
jest.mock('child_process', () => ({
  exec: jest.fn((cmd, cb) => cb(null, { stdout: '', stderr: '' }))
}));

jest.mock('node-dns-sd', () => ({
  discover: jest.fn(() => Promise.resolve([]))
}));

jest.mock('../db', () => {
  const mDb = {
    all: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    run: jest.fn().mockResolvedValue({})
  };
  return { getDb: jest.fn(() => Promise.resolve(mDb)) };
});

const { handleNetworkScanner } = require('../tools/network_scanner');

describe('Network Scanner Tool tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('unknown action returns error message', async () => {
    const res = await handleNetworkScanner('unknown_action');
    expect(res).toContain('Error: Unknown action');
  });

  test('valid scan action with subnet parses parameter successfully', async () => {
    const res = await handleNetworkScanner('scan_network', { subnet: '192.168.1.1' });
    expect(res).toContain('Network Scan Report');
    expect(res).toContain('192.168.1.0/24');
  });
});
