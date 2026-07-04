const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
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

  test('POST /api/update accepts request with valid HMAC signature', async () => {
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
