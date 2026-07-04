const request = require('supertest');
const express = require('express');
const agentBridgeRouter = require('../routes/agent_bridge');
const dbModule = require('../db');

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: 1, username: 'testuser' };
    next();
  }
}));

jest.mock('../db', () => {
  const mDb = {
    get: jest.fn()
  };
  return { getDb: jest.fn(() => Promise.resolve(mDb)) };
});

const app = express();
app.use(express.json());
app.use('/api/agent-bridge', agentBridgeRouter);

describe('Agent Bridge API Tests', () => {
  let mockDb;

  beforeEach(async () => {
    mockDb = await dbModule.getDb();
    jest.clearAllMocks();
  });

  test('POST /api/agent-bridge/execute rejects if parameters missing', async () => {
    const res = await request(app)
      .post('/api/agent-bridge/execute')
      .send({ nodeId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });

  test('POST /api/agent-bridge/execute returns 404 if node not found', async () => {
    mockDb.get.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/agent-bridge/execute')
      .send({ nodeId: 99, command: 'gpio write 5 1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Node not found');
  });

  test('POST /api/agent-bridge/execute executes successfully (simulated)', async () => {
    mockDb.get.mockResolvedValueOnce({
      id: 1,
      node_name: 'Test Node',
      ip_address: '192.168.1.100',
      port: 3000
    });
    const res = await request(app)
      .post('/api/agent-bridge/execute')
      .send({ nodeId: 1, command: 'gpio write 5 1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.simulated_output).toBeDefined();
  });

  test('POST /api/agent-bridge/execute handles database error', async () => {
    mockDb.get.mockRejectedValueOnce(new Error('DB connection lost'));
    const res = await request(app)
      .post('/api/agent-bridge/execute')
      .send({ nodeId: 1, command: 'gpio write 5 1' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB connection lost');
  });
});
