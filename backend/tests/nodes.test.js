const request = require('supertest');
const express = require('express');
const nodesRouter = require('../routes/nodes');
const authMiddleware = require('../middleware/auth');
const dbModule = require('../db');

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: 1, username: 'testuser' };
    next();
  }
}));

jest.mock('../db', () => {
  const mDb = {
    all: jest.fn(),
    get: jest.fn(),
    run: jest.fn()
  };
  return { getDb: jest.fn(() => Promise.resolve(mDb)) };
});

const app = express();
app.use(express.json());
app.use('/api/nodes', nodesRouter);

describe('Nodes API', () => {
  let mockDb;

  beforeEach(async () => {
    mockDb = await dbModule.getDb();
    jest.clearAllMocks();
  });

  test('GET /api/nodes returns nodes list', async () => {
    mockDb.all.mockResolvedValueOnce([{ id: 1, node_name: 'Pi Node', is_online: 1 }]);
    const res = await request(app).get('/api/nodes');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, node_name: 'Pi Node', is_online: 1 }]);
    expect(mockDb.all).toHaveBeenCalledWith(expect.any(String), [1]);
  });

  test('POST /api/nodes adds a node', async () => {
    mockDb.run.mockResolvedValueOnce({ lastID: 2 });
    const res = await request(app).post('/api/nodes').send({
      node_name: 'ESP32 Sensor',
      device_type: 'esp32-wroom',
      ip_address: '192.168.1.100',
      port: 80
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(2);
  });

  test('DELETE /api/nodes/:id deletes a node', async () => {
    mockDb.run.mockResolvedValueOnce();
    const res = await request(app).delete('/api/nodes/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
