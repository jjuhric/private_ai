const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const child_process = require('child_process');

// Mock child_process
jest.mock('child_process', () => {
  return {
    exec: jest.fn()
  };
});

const updateRouter = require('../routes/update');

describe('Auto-Update Webhook Router Tests', () => {
  let app;
  const originalSecret = process.env.UPDATE_WEBHOOK_SECRET;

  beforeAll(() => {
    app = express();
    app.use('/api/update', updateRouter);
    process.env.UPDATE_WEBHOOK_SECRET = 'webhook_test_secret';
  });

  afterAll(() => {
    process.env.UPDATE_WEBHOOK_SECRET = originalSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/update rejects request with missing signature', async () => {
    const res = await request(app)
      .post('/api/update')
      .send({ ref: 'refs/heads/main' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toContain('Invalid webhook signature');
  });

  test('POST /api/update rejects request with incorrect signature', async () => {
    const res = await request(app)
      .post('/api/update')
      .set('X-Hub-Signature-256', 'sha256=invalid_hash')
      .send({ ref: 'refs/heads/main' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/update accepts request with valid HMAC signature and runs exec success', async () => {
    // Setup exec mock to run callback with success (no error)
    child_process.exec.mockImplementationOnce((cmd, options, callback) => {
      callback(null, 'stdout output', '');
    });

    const payload = JSON.stringify({ ref: 'refs/heads/main' });
    const hmac = crypto.createHmac('sha256', 'webhook_test_secret');
    const signature = 'sha256=' + hmac.update(payload).digest('hex');

    const res = await request(app)
      .post('/api/update')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('update_queued');
    expect(child_process.exec).toHaveBeenCalled();
  });

  test('POST /api/update handles exec error', async () => {
    // Setup exec mock to run callback with error
    child_process.exec.mockImplementationOnce((cmd, options, callback) => {
      callback(new Error('Mocked exec failure'), '', 'stderr error');
    });

    const payload = JSON.stringify({ ref: 'refs/heads/main' });
    const hmac = crypto.createHmac('sha256', 'webhook_test_secret');
    const signature = 'sha256=' + hmac.update(payload).digest('hex');

    const res = await request(app)
      .post('/api/update')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('update_queued');
    expect(child_process.exec).toHaveBeenCalled();
  });

  test('POST /api/update checks DEPLOY_MODE backend-only', async () => {
    const originalDeployMode = process.env.DEPLOY_MODE;
    process.env.DEPLOY_MODE = 'backend-only';

    child_process.exec.mockImplementationOnce((cmd, options, callback) => {
      callback(null, 'stdout output', '');
    });

    const payload = JSON.stringify({ ref: 'refs/heads/main' });
    const hmac = crypto.createHmac('sha256', 'webhook_test_secret');
    const signature = 'sha256=' + hmac.update(payload).digest('hex');

    await request(app)
      .post('/api/update')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(child_process.exec).toHaveBeenCalledWith(
      expect.stringContaining('npm install'),
      expect.any(Object),
      expect.any(Function)
    );

    process.env.DEPLOY_MODE = originalDeployMode;
  });

  test('POST /api/update returns 500 if webhook secret is missing', async () => {
    delete process.env.UPDATE_WEBHOOK_SECRET;

    const res = await request(app)
      .post('/api/update')
      .send({ ref: 'refs/heads/main' });

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toContain('Webhook secret not configured');

    process.env.UPDATE_WEBHOOK_SECRET = 'webhook_test_secret';
  });
});
