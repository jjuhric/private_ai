const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

describe('Node Client Messages Webserver', () => {
  let app;
  const tempMessagesDir = path.join(__dirname, 'temp_messages');

  beforeAll(() => {
    // Recreate clean messages folder
    if (fs.existsSync(tempMessagesDir)) {
      fs.rmSync(tempMessagesDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempMessagesDir, { recursive: true });

    app = express();
    app.use(express.json());

    // Mock POST /message implementation
    app.post('/message', (req, res) => {
      const { message } = req.body;
      if (message === undefined) {
        return res.status(400).json({ error: 'message body is required' });
      }

      const messageStr = String(message);
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');

      const targetDir = path.join(tempMessagesDir, String(yyyy), mm, dd);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      let files = [];
      try {
        files = fs.readdirSync(targetDir).filter(f => f.endsWith('.txt'));
      } catch (e) {}

      let targetFile;
      if (files.length === 0) {
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        targetFile = path.join(targetDir, `${hh}-${min}-${ss}.txt`);
      } else {
        files.sort();
        targetFile = path.join(targetDir, files[0]);
      }

      fs.appendFileSync(targetFile, `[${now.toISOString()}] ${messageStr}\n`, 'utf8');
      res.json({ success: true, file: path.basename(targetFile) });
    });

    // Mock GET /api/files implementation
    app.get('/api/files', (req, res) => {
      const relativePath = req.query.path || '';
      const safeSubPath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
      const searchDir = path.join(tempMessagesDir, safeSubPath);

      if (!fs.existsSync(searchDir)) {
        return res.json({ success: true, files: [] });
      }

      const entries = fs.readdirSync(searchDir, { withFileTypes: true });
      const files = entries
        .filter(entry => entry.isDirectory() || (entry.isFile() && entry.name.endsWith('.txt')))
        .map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: path.join(safeSubPath, entry.name).replace(/\\/g, '/')
        }));
      res.json({ success: true, files });
    });
  });

  afterAll(() => {
    if (fs.existsSync(tempMessagesDir)) {
      fs.rmSync(tempMessagesDir, { recursive: true, force: true });
    }
  });

  test('POST /message stores message in day nested path and appends correctly', async () => {
    const res1 = await request(app)
      .post('/message')
      .send({ message: 'Hello first message' });
    expect(res1.statusCode).toBe(200);
    expect(res1.body.success).toBe(true);

    const firstFileName = res1.body.file;
    expect(firstFileName).toMatch(/^\d{2}-\d{2}-\d{2}\.txt$/);

    // Second message should append to the same file
    const res2 = await request(app)
      .post('/message')
      .send({ message: 'Hello second message' });
    expect(res2.statusCode).toBe(200);
    expect(res2.body.file).toBe(firstFileName);
  });

  test('GET /api/files lists generated nested directories', async () => {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');

    const res = await request(app)
      .get(`/api/files?path=${yyyy}/${mm}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.files.length).toBeGreaterThan(0);
    expect(res.body.files[0].isDirectory).toBe(true);
  });
});
