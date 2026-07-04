const request = require('supertest');
const express = require('express');
const hostRouter = require('../routes/host');
const hostMachineTool = require('../tools/host_machine_tool');

// Mock auth middleware
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: 1 };
    next();
  }
}));

// Mock host_machine_tool
jest.mock('../tools/host_machine_tool', () => ({
  handleHostMachineTool: jest.fn()
}));

describe('Host Route Telemetry and Control Tests', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/host', hostRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/host/status returns hardware telemetry successfully', async () => {
    hostMachineTool.handleHostMachineTool.mockImplementation((action) => {
      if (action === 'get_temperature') return Promise.resolve('42.5°C');
      if (action === 'get_power') return Promise.resolve('Power telemetry output');
      if (action === 'get_network_info') return Promise.resolve('Network info output');
      if (action === 'get_capabilities') return Promise.resolve({ deviceType: 'rpi-5', isMainHost: 0, capabilities: { gpio: true } });
      return Promise.resolve('');
    });

    const res = await request(app).get('/api/host/status');

    expect(res.statusCode).toBe(200);
    expect(res.body.cpu).toBeDefined();
    expect(res.body.memory).toBeDefined();
    expect(res.body.telemetry.temperature).toBe('42.5°C');
    expect(res.body.telemetry.power).toBe('Power telemetry output');
  });

  test('GET /api/host/status handles failure', async () => {
    hostMachineTool.handleHostMachineTool.mockRejectedValue(new Error('Telemetry failure'));
    const res = await request(app).get('/api/host/status');
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Telemetry failure');
  });

  test('POST /api/host/service/restart restarts whitelisted service', async () => {
    hostMachineTool.handleHostMachineTool.mockResolvedValue('Successfully restarted service "test-service".');
    const res = await request(app)
      .post('/api/host/service/restart')
      .send({ service: 'test-service' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/host/service/restart handles non-success response', async () => {
    hostMachineTool.handleHostMachineTool.mockResolvedValue('Failed to restart service - systemd error.');
    const res = await request(app)
      .post('/api/host/service/restart')
      .send({ service: 'test-service' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Failed to restart service - systemd error.');
  });

  test('POST /api/host/service/restart handles throw catch block', async () => {
    hostMachineTool.handleHostMachineTool.mockRejectedValue(new Error('Restart throw error'));
    const res = await request(app)
      .post('/api/host/service/restart')
      .send({ service: 'test-service' });

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Restart throw error');
  });

  test('POST /api/host/service/restart returns 400 if service is missing', async () => {
    const res = await request(app)
      .post('/api/host/service/restart')
      .send({});

    expect(res.statusCode).toBe(400);
  });

  test('POST /api/host/gpio/run triggers safe script execution', async () => {
    hostMachineTool.handleHostMachineTool.mockResolvedValue('Script output');
    const res = await request(app)
      .post('/api/host/gpio/run')
      .send({ scriptPath: 'script.py' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output).toBe('Script output');
  });

  test('POST /api/host/gpio/run handles throw catch block', async () => {
    hostMachineTool.handleHostMachineTool.mockRejectedValue(new Error('Script throw error'));
    const res = await request(app)
      .post('/api/host/gpio/run')
      .send({ scriptPath: 'script.py' });

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Script throw error');
  });

  test('POST /api/host/gpio/run returns 400 if scriptPath is missing', async () => {
    const res = await request(app)
      .post('/api/host/gpio/run')
      .send({});

    expect(res.statusCode).toBe(400);
  });
});
