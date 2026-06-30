const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

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

const profileRouter = require('../routes/profile');
const { JWT_SECRET } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use('/api/profile', profileRouter);

describe('Profile Router Tests', () => {
  let token;
  let userId;

  beforeAll(async () => {
    // Require internally to avoid out of scope reference in beforeAll
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

    // Create user and generate token
    const result = await db.run("INSERT INTO users (username, password_hash) VALUES ('profileuser', 'hashed')");
    userId = result.lastID;
    token = jwt.sign({ id: userId, username: 'profileuser' }, JWT_SECRET);
  });

  afterAll(async () => {
    if (mockTestDb) {
      await mockTestDb.close();
      mockTestDb = null;
    }
  });

  beforeEach(() => {
    mockDbError = false;
  });

  test('GET /api/profile - returns empty profile initially', async () => {
    const res = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      name: null,
      zipcode: null,
      country: 'US',
      temp_unit: 'imperial',
      weather_api_key: null
    });
  });

  test('PUT /api/profile - updates preferences', async () => {
    const payload = {
      name: 'John Doe',
      zipcode: '90210',
      country: 'CA',
      temp_unit: 'metric',
      weather_api_key: 'apikey123'
    };

    const res = await request(app)
      .put('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Profile updated successfully.' });

    // Verify GET reflects updates
    const getRes = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toEqual(payload);
  });

  test('error paths - database failure catches', async () => {
    mockDbError = true;

    const getRes = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.statusCode).toBe(500);

    const putRes = await request(app)
      .put('/api/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Error Name' });
    expect(putRes.statusCode).toBe(500);
  });
});
