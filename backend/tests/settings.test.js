const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock db.js
let mockTestDb = null;
jest.mock('../db', () => {
  const { open } = require('sqlite');
  const sqlite3 = require('sqlite3');
  const fs = require('fs');
  const path = require('path');

  return {
    getDb: async () => {
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

// Mock global fetch
global.fetch = jest.fn();

const settingsRouter = require('../routes/settings');
const { JWT_SECRET } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use('/api/settings', settingsRouter);

describe('Settings Router Tests', () => {
  let token;
  let userId;

  beforeAll(async () => {
    const { open } = require('sqlite');
    const sqlite3 = require('sqlite3');
    const fs = require('fs');
    const path = require('path');

    const db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });
    mockTestDb = db;
    const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
    await mockTestDb.exec(schemaSql);

    const result = await db.run("INSERT INTO users (username, password_hash) VALUES ('settingsuser', 'hashed')");
    userId = result.lastID;
    token = jwt.sign({ id: userId, username: 'settingsuser' }, JWT_SECRET);
  });

  afterAll(async () => {
    if (mockTestDb) {
      await mockTestDb.close();
      mockTestDb = null;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/settings - retrieves or inserts user settings', async () => {
    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('user_id', userId);
    expect(res.body.provider).toBe('local');
    expect(res.body.model_name).toBe('google/gemma-4-e4b');
  });

  test('PUT /api/settings - updates user settings configurations', async () => {
    const payload = {
      provider: 'online',
      model_name: 'gemini-2.5-flash',
      online_provider: 'gemini',
      online_key: 'gemini_test_key'
    };

    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Settings updated successfully.' });

    // Verify GET retrieves update
    const getRes = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.body.provider).toBe('online');
    expect(getRes.body.online_key).toBe('gemini_test_key');
  });

  test('GET /api/settings/local-models - success path', async () => {
    // Mock local fetch response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'local-model-1' }, { id: 'local-model-2' }]
      })
    });

    const res = await request(app)
      .get('/api/settings/local-models')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(['local-model-1', 'local-model-2']);
  });

  test('GET /api/settings/local-models - fetch error fallback', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Connection failed'));

    const res = await request(app)
      .get('/api/settings/local-models')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    // Returns default local models fallback list
    expect(res.body).toContain('google/gemma-4-e4b');
  });

  test('GET /api/settings/online-models - gemini success path', async () => {
    // Mock gemini fetch response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-001', supportedGenerationMethods: ['generateContent'] }, // should filter out checkpoint
          { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] } // should filter out embedding
        ]
      })
    });

    const res = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(['gemini-2.5-flash']);
  });
});
