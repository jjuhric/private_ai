const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

let mockDb = null;
jest.mock('../db', () => ({
  getDb: async () => mockDb
}));

const { checkQuota } = require('../middleware/quotaMiddleware');
const alertsRouter = require('../routes/alerts');
const settingsRouter = require('../routes/settings');
const { JWT_SECRET } = require('../middleware/auth');

const app = express();
app.use(express.json());

// Dummy authenticated route wrapped with checkQuota
app.get('/test-quota', (req, res, next) => {
  req.user = { id: 1 };
  next();
}, checkQuota, (req, res) => {
  res.json({ success: true });
});

app.use('/api/alerts', alertsRouter);
app.use('/api/settings', settingsRouter);

describe('Quota Enforcement and Alerts Stream Tests', () => {
  let token;
  let adminToken;
  const userId = 1;

  beforeAll(() => {
    token = jwt.sign({ id: userId, username: 'quotauser' }, JWT_SECRET);
    adminToken = jwt.sign({ id: 2, username: 'admin' }, JWT_SECRET);
  });

  beforeEach(() => {
    mockDb = {
      get: jest.fn().mockImplementation(async (query, params) => {
        if (query.includes('SELECT id FROM users')) {
          return { id: params ? params[0] : 1 };
        }
        return null;
      }),
      all: jest.fn(),
      run: jest.fn()
    };
  });

  test('checkQuota allows requests when usage is below quota', async () => {
    // Mock user settings showing quota is 100,000
    mockDb.get.mockImplementation(async (query, params) => {
      if (query.includes('SELECT id FROM users')) {
        return { id: params ? params[0] : 1 };
      }
      if (query.includes('token_quota')) {
        return { token_quota: params[0] === 1 ? 100000 : 10000, provider: 'online' };
      }
      if (query.includes('SUM(token_count)')) {
        return { total: 5000 }; // Only 5,000 tokens used in last 24h
      }
      return null;
    });

    const res = await request(app)
      .get('/test-quota')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('checkQuota blocks requests and returns 429 when usage exceeds quota', async () => {
    // Mock user settings showing quota is 10,000
    mockDb.get.mockImplementation(async (query, params) => {
      if (query.includes('SELECT id FROM users')) {
        return { id: params ? params[0] : 1 };
      }
      if (query.includes('token_quota')) {
        return { token_quota: 10000, provider: 'online' };
      }
      if (query.includes('SUM(token_count)')) {
        return { total: 15000 }; // 15,000 tokens used, quota exceeded
      }
      return null;
    });

    const res = await request(app)
      .get('/test-quota')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
    expect(res.body.message).toContain('Daily token quota exceeded');
  });

  test('custom errors are constructed correctly', () => {
    const { AppError, QuotaExceededError, ServiceUnavailableError, CommandExecutionError } = require('../utils/errors');
    
    const err1 = new AppError('msg', 'CODE', 400);
    expect(err1.message).toBe('msg');
    expect(err1.code).toBe('CODE');
    expect(err1.statusCode).toBe(400);

    const err2 = new QuotaExceededError();
    expect(err2.code).toBe('QUOTA_EXCEEDED');
    expect(err2.statusCode).toBe(429);

    const err3 = new ServiceUnavailableError();
    expect(err3.code).toBe('SERVICE_UNAVAILABLE');
    expect(err3.statusCode).toBe(503);

    const err4 = new CommandExecutionError();
    expect(err4.code).toBe('COMMAND_FAILED');
    expect(err4.statusCode).toBe(500);
  });

  test('checkQuota handles database error gracefully', async () => {
    mockDb.get.mockRejectedValue(new Error('DB connection failed'));
    
    const res = await request(app)
      .get('/test-quota')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(500);
  });

  test('broadcastAlert handles empty active client pool and string message', () => {
    const { broadcastAlert } = require('../routes/alerts');
    expect(() => broadcastAlert('hello world')).not.toThrow();
  });

  test('admin endpoints block non-admin users', async () => {
    const resGet = await request(app)
      .get('/api/settings/admin/users')
      .set('Authorization', `Bearer ${token}`);
    expect(resGet.statusCode).toBe(403);

    const resPut = await request(app)
      .put('/api/settings/admin/users/1/quota')
      .set('Authorization', `Bearer ${token}`)
      .send({ token_quota: 50000 });
    expect(resPut.statusCode).toBe(403);
  });

  test('admin endpoints allow admin to get and update quotas', async () => {
    mockDb.all = jest.fn().mockResolvedValue([
      { id: 1, username: 'quotauser', name: 'Quota User', token_quota: 100000, total_used_24h: 5000 }
    ]);
    mockDb.run = jest.fn().mockResolvedValue({ changes: 1 });

    const resGet = await request(app)
      .get('/api/settings/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.body[0].username).toBe('quotauser');

    const resPut = await request(app)
      .put('/api/settings/admin/users/1/quota')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ token_quota: 50000 });
    expect(resPut.statusCode).toBe(200);
    expect(resPut.body.success).toBe(true);

    const resPutInvalid = await request(app)
      .put('/api/settings/admin/users/1/quota')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ token_quota: -10 });
    expect(resPutInvalid.statusCode).toBe(400);
  });
});
