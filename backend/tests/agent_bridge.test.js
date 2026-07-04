const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock db
let mockDb = {
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn()
};
jest.mock('../db', () => ({
  getDb: jest.fn(() => Promise.resolve(mockDb))
}));

// Mock child_process spawn
const mockSpawn = jest.fn(() => ({ unref: jest.fn() }));
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: (...args) => mockSpawn(...args)
}));

// Mock coder tools
const mockHandleCoderTool = jest.fn();
jest.mock('../tools/coder_tools', () => ({
  handleCoderTool: (...args) => mockHandleCoderTool(...args)
}));

// Mock host machine tool
const mockHandleHostMachineTool = jest.fn();
jest.mock('../tools/host_machine_tool', () => ({
  handleHostMachineTool: (...args) => mockHandleHostMachineTool(...args)
}));

const JWT_SECRET = 'dev_secret_key_private_ai_assistant_2026';
const testToken = jwt.sign({ id: 1 }, JWT_SECRET);

describe('agent_bridge.js API Endpoint Tests', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    const router = require('../routes/agent_bridge');
    app.use('/api/bridge', router);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /execute: 401 if missing Authorization header', async () => {
    const res = await request(app)
      .post('/api/bridge/execute')
      .send({ action: 'system_info' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Authorization header is required');
  });

  test('POST /execute: 401 if token is empty in header', async () => {
    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', 'Bearer ')
      .send({ action: 'system_info' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Token is required');
  });

  test('POST /execute: 403 if invalid token', async () => {
    mockDb.get.mockResolvedValueOnce(null); // No matching bridge secret either

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', 'Bearer invalid_token')
      .send({ action: 'system_info' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Forbidden');
  });

  test('POST /execute: success via standard JWT token', async () => {
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 }); // Settings check (not main host)
    mockHandleHostMachineTool.mockResolvedValue('telemetry_report');

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'system_info' });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('System telemetry details');
  });

  test('POST /execute: success via bridge_secret', async () => {
    // 1st get (in authenticateBridge: settings):
    mockDb.get.mockResolvedValueOnce({ local_key: null });
    // 2nd get (in authenticateBridge: network_nodes): Match bridge_secret in network_nodes
    mockDb.get.mockResolvedValueOnce({ id: 4, user_id: 1, node_name: 'MainCaller', bridge_secret: 'bridge_secret_123' });
    // 3rd get (in route handler): Settings check (is_main_host = 0)
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });
    
    mockHandleHostMachineTool.mockResolvedValue('telemetry_report');

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', 'Bearer bridge_secret_123')
      .send({ action: 'system_info' });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('System telemetry details');
  });

  test('POST /execute: success via BRIDGE_SECRET environment variable', async () => {
    process.env.BRIDGE_SECRET = 'env_secret_999';
    // 1st get (in authenticateBridge for firstUser):
    mockDb.get.mockResolvedValueOnce({ id: 1 });
    // 2nd get (in route handler): Settings check (is_main_host = 0)
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });
    
    mockHandleHostMachineTool.mockResolvedValue('telemetry_report');

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', 'Bearer env_secret_999')
      .send({ action: 'system_info' });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('System telemetry details');
    delete process.env.BRIDGE_SECRET;
  });

  test('POST /execute: success via decrypted local_key in user_settings', async () => {
    const { encrypt } = require('../utils/crypto');
    const encryptedKey = encrypt('my_local_key_token_888');

    // 1st get (in authenticateBridge: settings):
    mockDb.get.mockResolvedValueOnce({ local_key: encryptedKey });
    // 2nd get (in authenticateBridge: firstUser):
    mockDb.get.mockResolvedValueOnce({ id: 1 });
    // 3rd get (in route handler): Settings check (is_main_host = 0)
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });
    
    mockHandleHostMachineTool.mockResolvedValue('telemetry_report');

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', 'Bearer my_local_key_token_888')
      .send({ action: 'system_info' });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('System telemetry details');
  });

  test('POST /execute: blocks requests if target is the Parent Node (is_main_host = 1)', async () => {
    // 1st get (in authenticateBridge: settings):
    mockDb.get.mockResolvedValueOnce({ local_key: null });
    // 2nd get (in authenticateBridge: network_nodes): Authenticate via bridge_secret
    mockDb.get.mockResolvedValueOnce({ id: 4, user_id: 1, node_name: 'MainCaller', bridge_secret: 'bridge_secret_123' });
    // 3rd get (in route handler): Settings check returns is_main_host = 1 (Parent node)
    mockDb.get.mockResolvedValueOnce({ is_main_host: 1 });

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', 'Bearer bridge_secret_123')
      .send({ action: 'run_command', params: { command: 'ls' } });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Access denied: Commands cannot be routed to the Parent Node');
  });

  test('POST /execute: routes run_command to handleCoderTool', async () => {
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });
    mockHandleCoderTool.mockResolvedValue('stdout: list of files');

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'run_command', params: { command: 'ls -la', sudo_password: 'root_password' } });

    expect(res.status).toBe(200);
    expect(mockHandleCoderTool).toHaveBeenCalledWith(
      'execute_command',
      expect.objectContaining({ command: 'ls -la', sudo_password: 'root_password' }),
      expect.any(Object)
    );
    expect(res.body.output).toBe('stdout: list of files');
  });

  test('POST /execute: routes write_file to handleCoderTool', async () => {
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });
    mockHandleCoderTool.mockResolvedValue('Successfully wrote content');

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'write_file', params: { filePath: 'notes.txt', content: 'hello world' } });

    expect(res.status).toBe(200);
    expect(mockHandleCoderTool).toHaveBeenCalledWith(
      'write_file',
      expect.objectContaining({ filePath: 'notes.txt', content: 'hello world' })
    );
  });

  test('POST /execute: routes read_file to handleCoderTool', async () => {
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });
    mockHandleCoderTool.mockResolvedValue('hello world content');

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'read_file', params: { filePath: 'notes.txt' } });

    expect(res.status).toBe(200);
    expect(mockHandleCoderTool).toHaveBeenCalledWith(
      'read_file',
      expect.objectContaining({ filePath: 'notes.txt' })
    );
  });

  test('POST /execute: triggers update_node background process on Windows', async () => {
    const os = require('os');
    const originalPlatform = os.platform;
    os.platform = () => 'win32';

    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'update_node' });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('Self-update initiated successfully');
    expect(mockSpawn).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.any(Object));

    os.platform = originalPlatform;
  });

  test('POST /execute: triggers update_node background process on Linux', async () => {
    const os = require('os');
    const originalPlatform = os.platform;
    os.platform = () => 'linux';

    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'update_node' });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('Self-update initiated successfully');
    expect(mockSpawn).toHaveBeenCalledWith('bash', expect.any(Array), expect.any(Object));

    os.platform = originalPlatform;
  });

  test('POST /execute: 400 on unrecognized action', async () => {
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'invalid_action' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unknown action');
  });

  test('POST /execute: routes get_specifications to handleHostMachineTool', async () => {
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });
    mockHandleHostMachineTool.mockResolvedValueOnce('mocked specifications report');

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'get_specifications', params: { detail: true } });

    expect(res.status).toBe(200);
    expect(res.body.output).toBe('mocked specifications report');
    expect(mockHandleHostMachineTool).toHaveBeenCalledWith('get_specifications', { detail: true }, 1);
  });

  test('POST /execute: routes get_service_status to handleHostMachineTool', async () => {
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });
    mockHandleHostMachineTool.mockResolvedValueOnce('mocked service status');

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'get_service_status', params: { serviceName: 'test-service' } });

    expect(res.status).toBe(200);
    expect(res.body.output).toBe('mocked service status');
    expect(mockHandleHostMachineTool).toHaveBeenCalledWith('get_service_status', { serviceName: 'test-service' }, 1);
  });

  test('POST /execute: 500 on execution error exception', async () => {
    mockDb.get.mockResolvedValueOnce({ is_main_host: 0 });
    mockHandleHostMachineTool.mockRejectedValueOnce(new Error('Internal handler crash'));

    const res = await request(app)
      .post('/api/bridge/execute')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ action: 'system_info' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Internal handler crash');
  });
});
