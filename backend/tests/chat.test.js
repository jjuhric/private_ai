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

// Mock runAgentLoop from ai.js
const mockRunAgentLoop = jest.fn();
jest.mock('../ai', () => ({
  runAgentLoop: (...args) => mockRunAgentLoop(...args),
  handleGoogleNewsTool: jest.fn()
}));

const chatRouter = require('../routes/chat');
const { JWT_SECRET } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use('/api', chatRouter);

describe('Chat Router Tests', () => {
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

    const userResult = await db.run("INSERT INTO users (username, password_hash) VALUES ('chatuser', 'hashed')");
    userId = userResult.lastID;
    token = jwt.sign({ id: userId, username: 'chatuser' }, JWT_SECRET);
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

  test('POST /api/chats & GET /api/chats - operations success', async () => {
    // Create chat
    const createRes = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'My Test Chat' });

    expect(createRes.statusCode).toBe(200);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.title).toBe('My Test Chat');
    expect(createRes.body.chatId).toBeDefined();

    // Get chats list
    const listRes = await request(app)
      .get('/api/chats')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body[0].title).toBe('My Test Chat');
  });

  test('PUT /api/chats/:id & DELETE /api/chats/:id - rename and delete operations', async () => {
    const db = await mockTestDb;
    const insertRes = await db.run('INSERT INTO chats (user_id, title) VALUES (?, ?)', [userId, 'Old Name']);
    const chatId = insertRes.lastID;

    // Bad rename input
    const badRename = await request(app)
      .put(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '' });
    expect(badRename.statusCode).toBe(400);

    // Good rename
    const renameRes = await request(app)
      .put(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New Name' });
    expect(renameRes.statusCode).toBe(200);

    const checkRename = await db.get('SELECT title FROM chats WHERE id = ?', [chatId]);
    expect(checkRename.title).toBe('New Name');

    // Get messages for chat (empty initially)
    const messagesRes = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set('Authorization', `Bearer ${token}`);
    expect(messagesRes.statusCode).toBe(200);
    expect(messagesRes.body.length).toBe(0);

    // Delete chat
    const delRes = await request(app)
      .delete(`/api/chats/${chatId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.statusCode).toBe(200);

    const checkDel = await db.get('SELECT id FROM chats WHERE id = ?', [chatId]);
    expect(checkDel).toBeUndefined();
  });

  test('POST /api/chat/stream - SSE streaming and thinking process XML/channel parsing', async () => {
    const db = await mockTestDb;
    const insertRes = await db.run('INSERT INTO chats (user_id, title) VALUES (?, ?)', [userId, 'Stream Chat']);
    const chatId = insertRes.lastID;

    // Mock agent loop behavior to call callbacks
    mockRunAgentLoop.mockImplementation(async (options) => {
      // Call thoughts callback
      options.onThought('Thinking chunk...');
      // Call content callback containing XML thoughts and normal response
      options.onContent('<think>Extracted XML thoughts</think>This is the final response.');
      // Call tool call callback
      options.onToolCall({ tool: 'weather', action: 'current' });
    });

    const res = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${token}`)
      .send({ chatId, message: 'What is the weather?' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    // Confirm that assistant response was successfully saved to DB
    const lastMsg = await db.get('SELECT * FROM messages WHERE chat_id = ? AND role = ? ORDER BY id DESC LIMIT 1', [chatId, 'assistant']);
    expect(lastMsg).toBeDefined();
    expect(lastMsg.content).toBe('This is the final response.');
    expect(lastMsg.thoughts).toBe('Thinking chunk...\nExtracted XML thoughts');
  });

  test('POST /api/chat/stream - channel thinking tag parsing fallback', async () => {
    const db = await mockTestDb;
    const insertRes = await db.run('INSERT INTO chats (user_id, title) VALUES (?, ?)', [userId, 'Stream Chat 2']);
    const chatId = insertRes.lastID;

    mockRunAgentLoop.mockImplementation(async (options) => {
      options.onContent('<|channel>thoughtExtracted channel thoughts<channel|>Response content.');
    });

    await request(app)
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${token}`)
      .send({ chatId, message: 'Hello' });

    const lastMsg = await db.get('SELECT * FROM messages WHERE chat_id = ? AND role = ? ORDER BY id DESC LIMIT 1', [chatId, 'assistant']);
    expect(lastMsg.content).toBe('Response content.');
    expect(lastMsg.thoughts).toBe('Extracted channel thoughts');
  });

  test('error paths - database failure catches', async () => {
    mockDbError = true;

    const listRes = await request(app)
      .get('/api/chats')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.statusCode).toBe(500);

    const createRes = await request(app)
      .post('/api/chats')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Fail' });
    expect(createRes.statusCode).toBe(500);

    const delRes = await request(app)
      .delete('/api/chats/999')
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.statusCode).toBe(500);

    const renameRes = await request(app)
      .put('/api/chats/999')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Fail' });
    expect(renameRes.statusCode).toBe(500);

    const msgsRes = await request(app)
      .get('/api/chats/999/messages')
      .set('Authorization', `Bearer ${token}`);
    expect(msgsRes.statusCode).toBe(500);
  });
});
