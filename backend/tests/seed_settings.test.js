const { main } = require('../scripts/seed_settings');
const bcrypt = require('bcryptjs');

// Mock db
let mockDb = {
  get: jest.fn(),
  run: jest.fn()
};
jest.mock('../db', () => ({
  getDb: jest.fn(() => Promise.resolve(mockDb))
}));

// Mock crypto
jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn((text) => `encrypted:${text}`)
}));

describe('seed_settings.js Tests', () => {
  let originalExit;

  beforeAll(() => {
    originalExit = process.exit;
    process.exit = jest.fn();
  });

  afterAll(() => {
    process.exit = originalExit;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should exit with 1 if username is empty', async () => {
    const argv = ['node', 'seed_settings.js', '--username=', '--password=pass'];
    await main(argv);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('should exit with 1 if password is too short', async () => {
    const argv = ['node', 'seed_settings.js', '--username=admin', '--password=123'];
    await main(argv);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('should seed new user and settings successfully', async () => {
    const argv = [
      'node', 'seed_settings.js',
      '--username=admin',
      '--password=password123',
      '--device_type=rpi-5-8gb',
      '--is_main_host=1',
      '--local_url=http://localhost:1234/v1',
      '--local_key=my-local-key',
      '--online_provider=openai',
      '--online_key=my-online-key'
    ];

    mockDb.get.mockResolvedValueOnce(null); // User does not exist
    mockDb.run.mockResolvedValueOnce({ lastID: 42 }); // User insert returns ID 42
    mockDb.run.mockResolvedValueOnce({}); // settings insert

    await main(argv);

    expect(mockDb.get).toHaveBeenCalledWith('SELECT id FROM users WHERE username = ?', ['admin']);
    expect(mockDb.run).toHaveBeenCalledWith(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      expect.any(Array)
    );
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('should update existing user and settings successfully', async () => {
    const argv = [
      'node', 'seed_settings.js',
      '--username=admin',
      '--password=password123',
      '--device_type=windows',
      '--is_main_host=0',
      '--local_url=http://localhost:1234/v1'
    ];

    mockDb.get.mockResolvedValueOnce({ id: 10 }); // User exists
    mockDb.run.mockResolvedValueOnce({}); // update user password
    mockDb.run.mockResolvedValueOnce({}); // settings update

    await main(argv);

    expect(mockDb.get).toHaveBeenCalledWith('SELECT id FROM users WHERE username = ?', ['admin']);
    expect(mockDb.run).toHaveBeenCalledWith(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [expect.any(String), 10]
    );
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('should exit with 1 on database error exception', async () => {
    const argv = ['node', 'seed_settings.js', '--username=admin', '--password=password'];
    mockDb.get.mockRejectedValueOnce(new Error('DB connection closed'));
    
    await main(argv);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
