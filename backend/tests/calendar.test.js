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

const calendarRouter = require('../routes/calendar');
const { handleCalendarTool } = require('../tools/calendar_tool');
const { JWT_SECRET } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use('/api/calendar', calendarRouter);

describe('Calendar Router & Tool Tests', () => {
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

    const result = await db.run("INSERT INTO users (username, password_hash) VALUES ('caluser', 'hashed')");
    userId = result.lastID;
    token = jwt.sign({ id: userId, username: 'caluser' }, JWT_SECRET);
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

  test('POST /api/calendar - add calendar event', async () => {
    const res = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Meeting 1',
        description: 'Monthly sync',
        start_time: '2026-06-30 10:00',
        end_time: '2026-06-30 11:00'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('eventId');
  });

  test('GET /api/calendar - list calendar events', async () => {
    const res = await request(app)
      .get('/api/calendar?date=2026-06-30')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].title).toBe('Meeting 1');
  });

  test('DELETE /api/calendar/:id - deletes calendar event', async () => {
    const db = await mockTestDb;
    const item = await db.get('SELECT id FROM calendar_events WHERE user_id = ? LIMIT 1', [userId]);
    expect(item).toBeDefined();

    const res = await request(app)
      .delete(`/api/calendar/${item.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });

    const check = await db.get('SELECT id FROM calendar_events WHERE id = ?', [item.id]);
    expect(check).toBeUndefined();
  });

  test('handleCalendarTool - add, list, delete, error', async () => {
    const db = await mockTestDb;

    // Add
    const addResult = await handleCalendarTool(db, userId, 'add', {
      title: 'Tool Sync',
      start_time: '2026-07-01 09:00',
      description: 'Tool test'
    });
    const parsedAdd = JSON.parse(addResult);
    expect(parsedAdd.success).toBe(true);
    expect(parsedAdd.eventId).toBeDefined();

    // List
    const listResult = await handleCalendarTool(db, userId, 'list', { date: '2026-07-01' });
    const parsedList = JSON.parse(listResult);
    expect(parsedList.length).toBe(1);
    expect(parsedList[0].title).toBe('Tool Sync');

    // Delete
    const delResult = await handleCalendarTool(db, userId, 'delete', { eventId: parsedAdd.eventId });
    expect(JSON.parse(delResult).success).toBe(true);

    // List again (empty)
    const listAgain = await handleCalendarTool(db, userId, 'list', { date: '2026-07-01' });
    expect(JSON.parse(listAgain).length).toBe(0);

    // Unknown action error
    const errResult = await handleCalendarTool(db, userId, 'unknown', {});
    expect(JSON.parse(errResult)).toHaveProperty('error');
  });

  test('error paths - database failure catches', async () => {
    mockDbError = true;

    const listRes = await request(app)
      .get('/api/calendar')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.statusCode).toBe(500);

    const addRes = await request(app)
      .post('/api/calendar')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Fail Event', start_time: '2026-06-30 10:00' });
    expect(addRes.statusCode).toBe(500);

    const delRes = await request(app)
      .delete('/api/calendar/999')
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.statusCode).toBe(500);
  });

  test('handleCalendarTool - validation errors', async () => {
    const db = await mockTestDb;

    // Add with missing title
    const addResultNoTitle = await handleCalendarTool(db, userId, 'add', {
      start_time: '2026-07-01 09:00'
    });
    expect(JSON.parse(addResultNoTitle)).toHaveProperty('error', 'Title and start_time are required');

    // Add with missing start_time
    const addResultNoTime = await handleCalendarTool(db, userId, 'add', {
      title: 'No Time Meeting'
    });
    expect(JSON.parse(addResultNoTime)).toHaveProperty('error', 'Title and start_time are required');

    // Delete with missing eventId
    const delResultNoId = await handleCalendarTool(db, userId, 'delete', {});
    expect(JSON.parse(delResultNoId)).toHaveProperty('error', 'eventId is required');
  });
});
