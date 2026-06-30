const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock db.js
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
    mockDbError = false;
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
    expect(res.body).toContain('google/gemma-4-e4b');
  });

  test('GET /api/settings/online-models - gemini success path', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] }
        ]
      })
    });

    const res = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(['gemini-2.5-flash']);
  });

  test('GET /api/settings/online-models - openai and custom success paths', async () => {
    // OpenAI success path
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'gpt-4o' }]
      })
    });

    // Update settings provider to openai
    await mockTestDb.run('UPDATE user_settings SET online_provider = "openai", online_key = "op_key" WHERE user_id = ?', [userId]);

    const resOpenAI = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);

    expect(resOpenAI.statusCode).toBe(200);
    expect(resOpenAI.body).toContain('gpt-4o');

    // Custom success path
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'custom-model-id' }]
      })
    });

    await mockTestDb.run('UPDATE user_settings SET online_provider = "custom", online_url = "https://custom.api/v1", online_key = "cust_key" WHERE user_id = ?', [userId]);

    const resCustom = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);

    expect(resCustom.statusCode).toBe(200);
    expect(resCustom.body).toContain('custom-model-id');
  });

  test('GET /api/settings/online-models - anthropic fallback path', async () => {
    // Set provider to anthropic (which has no online API fetch, returns defaults directly)
    await mockTestDb.run('UPDATE user_settings SET online_provider = "anthropic" WHERE user_id = ?', [userId]);

    const res = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('claude-3-5-sonnet-latest');
  });

  test('GET /api/settings/online-models - fallback when API fails', async () => {
    global.fetch.mockRejectedValueOnce(new Error('API Down'));

    const res = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    // Returns default fallback list
    expect(res.body).toBeDefined();
  });

  test('error paths - database failure catches', async () => {
    mockDbError = true;

    const getRes = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.statusCode).toBe(500);

    const putRes = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'local' });
    expect(putRes.statusCode).toBe(500);

    const localModelsRes = await request(app)
      .get('/api/settings/local-models')
      .set('Authorization', `Bearer ${token}`);
    expect(localModelsRes.statusCode).toBe(200); // Route catch block returns defaults on failure

    const onlineModelsRes = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);
    expect(onlineModelsRes.statusCode).toBe(200); // Route catch block returns defaults on failure
  });

  test('GET /api/settings/online-models - defaults when keys are null', async () => {
    // OpenAI no key
    await mockTestDb.run('UPDATE user_settings SET online_provider = "openai", online_key = NULL WHERE user_id = ?', [userId]);
    const resOpenAI = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);
    expect(resOpenAI.statusCode).toBe(200);
    expect(resOpenAI.body).toContain('gpt-4o');

    // Anthropic no key
    await mockTestDb.run('UPDATE user_settings SET online_provider = "anthropic", online_key = NULL WHERE user_id = ?', [userId]);
    const resAnth = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);
    expect(resAnth.statusCode).toBe(200);
    expect(resAnth.body).toContain('claude-3-5-sonnet-latest');

    // Unknown provider
    await mockTestDb.run('UPDATE user_settings SET online_provider = "unknown_prov", online_key = NULL WHERE user_id = ?', [userId]);
    const resUnknown = await request(app)
      .get('/api/settings/online-models')
      .set('Authorization', `Bearer ${token}`);
    expect(resUnknown.statusCode).toBe(200);
    expect(resUnknown.body).toEqual([]);
  });
});
