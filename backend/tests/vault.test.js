const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Mock embeddings utility
jest.mock('../utils/embeddings', () => ({
  getEmbedding: async () => [0.1, 0.2, 0.3],
  getSemanticSimilarity: () => 0.9
}));

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
      if (mockDbError) throw new Error('Database connection failed');
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

const vaultRouter = require('../routes/vault');
const { JWT_SECRET } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use('/api/vault', vaultRouter);

describe('Vault API Router Tests', () => {
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

    const result = await db.run("INSERT INTO users (username, password_hash) VALUES ('vaultuser', 'hashed')");
    userId = result.lastID;
    token = jwt.sign({ id: userId, username: 'vaultuser' }, JWT_SECRET);
  });

  afterAll(async () => {
    if (mockTestDb) {
      await mockTestDb.close();
      mockTestDb = null;
    }

    // Clean up created vault test files
    const vaultDir = path.join(process.cwd(), 'vault');
    if (fs.existsSync(vaultDir)) {
      const files = fs.readdirSync(vaultDir);
      for (const file of files) {
        fs.unlinkSync(path.join(vaultDir, file));
      }
      fs.rmdirSync(vaultDir);
    }
  });

  beforeEach(() => {
    mockDbError = false;
  });

  test('GET /api/vault - lists indexed documents (empty initially)', async () => {
    const res = await request(app)
      .get('/api/vault')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/vault - uploads and indexes a document', async () => {
    const res = await request(app)
      .post('/api/vault')
      .set('Authorization', `Bearer ${token}`)
      .send({ filename: 'test_doc.md', content: 'This is some test content for RAG.' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('indexed successfully');
  });

  test('GET /api/vault - lists uploaded document after index', async () => {
    const res = await request(app)
      .get('/api/vault')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].filename).toBe('test_doc.md');
  });

  test('POST /api/vault - returns error on invalid filename/content', async () => {
    const res = await request(app)
      .post('/api/vault')
      .set('Authorization', `Bearer ${token}`)
      .send({ filename: '', content: '' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('DELETE /api/vault/:id - returns 404 for non-existent document', async () => {
    const res = await request(app)
      .delete('/api/vault/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(404);
  });

  test('DELETE /api/vault/:id - deletes existing document', async () => {
    const db = await mockTestDb;
    const doc = await db.get('SELECT id FROM vault_documents WHERE user_id = ? LIMIT 1', [userId]);
    expect(doc).toBeDefined();

    const res = await request(app)
      .delete(`/api/vault/${doc.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('DELETE /api/vault/:id - deletes existing document when fs throws error', async () => {
    // Index a new doc to delete
    await request(app)
      .post('/api/vault')
      .set('Authorization', `Bearer ${token}`)
      .send({ filename: 'test_delete_fs_error.md', content: 'content' });

    const db = await mockTestDb;
    const doc = await db.get("SELECT id FROM vault_documents WHERE filename = 'test_delete_fs_error.md' LIMIT 1");
    expect(doc).toBeDefined();

    const originalExists = fs.existsSync;
    const originalUnlink = fs.unlinkSync;

    fs.existsSync = () => true;
    fs.unlinkSync = () => { throw new Error('Unlink simulated error'); };

    try {
      const res = await request(app)
        .delete(`/api/vault/${doc.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    } finally {
      fs.existsSync = originalExists;
      fs.unlinkSync = originalUnlink;
    }
  });

  test('Database errors throw 500 status code', async () => {
    mockDbError = true;

    const getRes = await request(app)
      .get('/api/vault')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.statusCode).toBe(500);

    const postRes = await request(app)
      .post('/api/vault')
      .set('Authorization', `Bearer ${token}`)
      .send({ filename: 'a.txt', content: 'b' });
    expect(postRes.statusCode).toBe(500);

    const deleteRes = await request(app)
      .delete('/api/vault/1')
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.statusCode).toBe(500);
  });
});
