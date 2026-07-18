const { main } = require('../scripts/read_settings');

// Mock db
let mockDb = {
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn()
};
jest.mock('../db', () => ({
  getDb: jest.fn(() => Promise.resolve(mockDb))
}));

// Mock crypto
jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn((text) => `decrypted:${text}`)
}));

describe('read_settings.js Tests', () => {
  let originalExit;
  let originalLog;
  let loggedOutput;

  beforeAll(() => {
    originalExit = process.exit;
    originalLog = console.log;
    process.exit = jest.fn();
    console.log = jest.fn((msg) => {
      loggedOutput = msg;
    });
  });

  afterAll(() => {
    process.exit = originalExit;
    console.log = originalLog;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    loggedOutput = undefined;
  });

  test('should print empty JSON if no user and settings exist', async () => {
    mockDb.get.mockResolvedValueOnce(null); // no user
    mockDb.get.mockResolvedValueOnce(null); // no settings
    
    await main();

    expect(loggedOutput).toBe('{}');
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('should print existing config settings JSON successfully', async () => {
    mockDb.get.mockResolvedValueOnce({ username: 'testuser' });
    mockDb.get.mockResolvedValueOnce({
      device_type: 'rpi-5-8gb',
      is_main_host: 0,
      local_url: 'http://192.168.1.50:1234/v1',
      local_key: 'local_secret',
      online_provider: 'gemini',
      online_key: 'gemini_secret'
    });

    await main();

    const result = JSON.parse(loggedOutput);
    expect(result.username).toBe('testuser');
    expect(result.device_type).toBe('rpi-5-8gb');
    expect(result.is_main_host).toBe(0);
    expect(result.local_key).toBe('decrypted:local_secret');
    expect(result.online_key).toBe('decrypted:gemini_secret');
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('should print empty JSON and exit status 0 on database connection error exception', async () => {
    mockDb.get.mockRejectedValueOnce(new Error('Connection failure'));
    
    await main();

    expect(loggedOutput).toBe('{}');
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
