const request = require('supertest');
const express = require('express');

// Mock db.js to use an in-memory database
let mockTestDb = null;
let mockDbError = false;
jest.mock('../db', () => {
  const { open } = require('sqlite');
  const sqlite3 = require('sqlite3');
  const fs = require('fs');
  const path = require('path');

  return {
    getDb: async () => {
      if (mockDbError) throw new Error('Database error');
      if (mockTestDb) return mockTestDb;
      mockTestDb = await open({
        filename: ':memory:',
        driver: sqlite3.Database
      });
      const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
      await mockTestDb.exec(schemaSql);
      return mockTestDb;
    }
  };
});

const authRouter = require('../routes/auth');
const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

describe('Auth Router Tests', () => {
  beforeEach(async () => {
    mockDbError = false;
    // Reset DB for each test by truncating users and settings
    if (mockTestDb) {
      await mockTestDb.run('DELETE FROM users');
      await mockTestDb.run('DELETE FROM user_settings');
    }
  });

  afterAll(async () => {
    if (mockTestDb) {
      await mockTestDb.close();
      mockTestDb = null;
    }
  });

  test('POST /api/auth/register - success', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'testuser', password: 'password123' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('userId');

    // Confirm DB row is created
    const db = await mockTestDb;
    const user = await db.get('SELECT * FROM users WHERE username = ?', ['testuser']);
    expect(user).toBeDefined();
    expect(user.username).toBe('testuser');

    // Confirm default settings are created
    const settings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [user.id]);
    expect(settings).toBeDefined();
    expect(settings.provider).toBe('local');
  });

  test('POST /api/auth/register - validation errors', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: '', password: '123' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/auth/register - username taken', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'taken', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'taken', password: 'password123' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'Username is already taken.');
  });

  test('POST /api/auth/login - success', async () => {
    // Register first
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'loginuser', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'loginuser', password: 'password123' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.username).toBe('loginuser');
  });

  test('POST /api/auth/login - invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: 'password123' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid username or password.');
  });

  test('GET /api/auth/me - authenticated', async () => {
    // Register and login
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'meuser', password: 'password123' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'meuser', password: 'password123' });

    const token = loginRes.body.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.username).toBe('meuser');
  });

  test('GET /api/auth/me - unauthenticated (missing token)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/auth/me - authenticated with invalid/expired token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid_token_here');
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Session expired or invalid.');
  });

  test('error paths - database failure catches', async () => {
    mockDbError = true;

    // Register route db error
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ username: 'dbfail', password: 'password123' });
    expect(regRes.statusCode).toBe(500);

    // Login route db error
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dbfail', password: 'password123' });
    expect(loginRes.statusCode).toBe(500);
  });
});
