const request = require('supertest');
const express = require('express');
const hostRouter = require('../routes/host');

// Mock auth middleware
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: 1 };
    next();
  }
}));

// Mock host_machine_tool
jest.mock('../tools/host_machine_tool', () => ({
  handleHostMachineTool: jest.fn().mockImplementation((action, params) => {
    if (action === 'get_temperature') return '42.5°C';
    if (action === 'get_power') return 'Power telemetry output';
    if (action === 'get_network_info') return 'Network info output';
    if (action === 'restart_service') return 'Successfully restarted service "test-service".';
    if (action === 'run_script') return 'Script output';
    return '';
  })
}));

describe('Host Route Telemetry and Control Tests', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/host', hostRouter);
  });

  test('GET /api/host/status returns hardware telemetry successfully', async () => {
    const res = await request(app)
      .get('/api/host/status');

    expect(res.statusCode).toBe(200);
    expect(res.body.cpu).toBeDefined();
    expect(res.body.memory).toBeDefined();
    expect(res.body.telemetry.temperature).toBe('42.5°C');
    expect(res.body.telemetry.power).toBe('Power telemetry output');
  });

  test('POST /api/host/service/restart restarts whitelisted service', async () => {
    const res = await request(app)
      .post('/api/host/service/restart')
      .send({ service: 'test-service' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/host/service/restart returns 400 if service is missing', async () => {
    const res = await request(app)
      .post('/api/host/service/restart')
      .send({});

    expect(res.statusCode).toBe(400);
  });

  test('POST /api/host/gpio/run triggers safe script execution', async () => {
    const res = await request(app)
      .post('/api/host/gpio/run')
      .send({ scriptPath: 'script.py' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.output).toBe('Script output');
  });

  test('POST /api/host/gpio/run returns 400 if scriptPath is missing', async () => {
    const res = await request(app)
      .post('/api/host/gpio/run')
      .send({});

    expect(res.statusCode).toBe(400);
  });
});
