const request = require('supertest');
const express = require('express');

// Mock os networkInterfaces
jest.mock('os', () => {
  const actualOs = jest.requireActual('os');
  return {
    ...actualOs,
    networkInterfaces: jest.fn().mockReturnValue({})
  };
});

// Mock net.Socket
let mockSocketShouldConnect = true;
jest.mock('net', () => {
  return {
    Socket: jest.fn().mockImplementation(() => {
      const listeners = {};
      return {
        setTimeout: jest.fn(),
        destroy: jest.fn(),
        connect: jest.fn().mockImplementation(function(port, ip) {
          if (mockSocketShouldConnect) {
            if (listeners['connect']) listeners['connect']();
          } else {
            if (listeners['timeout']) listeners['timeout']();
          }
        }),
        on: jest.fn().mockImplementation((event, callback) => {
          listeners[event] = callback;
        })
      };
    })
  };
});

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
    mockDb.all.mockResolvedValueOnce([{ id: 1, node_name: 'Pi Node', is_online: 1, ssh_username: null, ssh_password: null, ssh_key: null }]);
    const res = await request(app).get('/api/nodes');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, node_name: 'Pi Node', is_online: 1, ssh_username: null, ssh_password: '', ssh_key: '' }]);
    expect(mockDb.all).toHaveBeenCalledWith(expect.any(String), [1]);
  });

  test('GET /api/nodes handles database error', async () => {
    mockDb.all.mockRejectedValueOnce(new Error('DB read error'));
    const res = await request(app).get('/api/nodes');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB read error');
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

  test('POST /api/nodes validation fails if parameters missing', async () => {
    const res = await request(app).post('/api/nodes').send({
      node_name: 'ESP32 Sensor'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });

  test('POST /api/nodes handles database error', async () => {
    mockDb.run.mockRejectedValueOnce(new Error('DB write error'));
    const res = await request(app).post('/api/nodes').send({
      node_name: 'ESP32 Sensor',
      device_type: 'esp32-wroom',
      ip_address: '192.168.1.100'
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB write error');
  });

  test('PUT /api/nodes/:id updates a node', async () => {
    mockDb.run.mockResolvedValueOnce();
    const res = await request(app).put('/api/nodes/1').send({
      node_name: 'New Node Name',
      device_type: 'rpi-5',
      ip_address: '192.168.1.101',
      port: 8080,
      is_online: 1
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('PUT /api/nodes/:id handles database error', async () => {
    mockDb.run.mockRejectedValueOnce(new Error('DB update error'));
    const res = await request(app).put('/api/nodes/1').send({
      node_name: 'New Node Name',
      device_type: 'rpi-5',
      ip_address: '192.168.1.101',
      port: 8080,
      is_online: 1
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB update error');
  });

  test('DELETE /api/nodes/:id deletes a node', async () => {
    mockDb.run.mockResolvedValueOnce();
    const res = await request(app).delete('/api/nodes/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('DELETE /api/nodes/:id handles database error', async () => {
    mockDb.run.mockRejectedValueOnce(new Error('DB delete error'));
    const res = await request(app).delete('/api/nodes/1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB delete error');
  });

  test('POST /api/nodes/:id/ping updates status', async () => {
    mockDb.run.mockResolvedValueOnce();
    const res = await request(app).post('/api/nodes/1/ping');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/nodes/:id/ping handles database error', async () => {
    mockDb.run.mockRejectedValueOnce(new Error('DB ping error'));
    const res = await request(app).post('/api/nodes/1/ping');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB ping error');
  });

  test('GET /api/nodes/discovery returns node specifications', async () => {
    mockDb.get.mockResolvedValueOnce({ device_type: 'rpi-5-8gb', is_main_host: 0 });
    const res = await request(app).get('/api/nodes/discovery');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.device_type).toBe('rpi-5-8gb');
    expect(res.body.is_main_host).toBe(false);
  });

  test('GET /api/nodes/discovery handles database error', async () => {
    mockDb.get.mockRejectedValueOnce(new Error('DB read settings error'));
    const res = await request(app).get('/api/nodes/discovery');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB read settings error');
  });

  test('POST /api/nodes/scan triggers local LAN scan and returns discovered list', async () => {
    const os = require('os');
    os.networkInterfaces.mockReturnValueOnce({
      eth0: [{ family: 'IPv4', internal: false, address: '192.168.10.50' }]
    });

    mockSocketShouldConnect = true;

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, device_type: 'rpi-5-16gb', is_main_host: false })
    });

    const res = await request(app).post('/api/nodes/scan');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.nodes.length).toBeGreaterThan(0);
    expect(res.body.nodes[0].ip_address).toContain('192.168.10.');
    expect(res.body.nodes[0].device_type).toBe('rpi-5-16gb');

    global.fetch = originalFetch;
  });

  test('POST /api/nodes/scan fallback subnet when networkInterfaces is empty', async () => {
    const os = require('os');
    os.networkInterfaces.mockReturnValueOnce({});

    mockSocketShouldConnect = false;

    const res = await request(app).post('/api/nodes/scan');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.nodes).toEqual([]);
  });

  test('POST /api/nodes/scan handles failure errors', async () => {
    const os = require('os');
    os.networkInterfaces.mockImplementationOnce(() => {
      throw new Error('OS network error');
    });

    const res = await request(app).post('/api/nodes/scan');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('OS network error');
  });
});
