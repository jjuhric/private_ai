const request = require('supertest');
const express = require('express');

// Mock authentication middleware
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: 1, username: 'testuser' };
    next();
  }
}));

// Mock DB
jest.mock('../db', () => {
  const mDb = {
    all: jest.fn(),
    get: jest.fn(),
    run: jest.fn()
  };
  return { getDb: jest.fn(() => Promise.resolve(mDb)) };
});

// Mock runWorkerAgent
jest.mock('../utils/agents', () => ({
  runWorkerAgent: jest.fn()
}));

const academyRouter = require('../routes/academy');
const dbModule = require('../db');
const { runWorkerAgent } = require('../utils/agents');

const app = express();
app.use(express.json());
app.use('/api/academy', academyRouter);

describe('Academy API', () => {
  let mockDb;

  beforeEach(async () => {
    mockDb = await dbModule.getDb();
    jest.clearAllMocks();
  });

  test('POST /api/academy/start starts a new lesson', async () => {
    mockDb.get.mockResolvedValueOnce({ provider: 'gemini', model_name: 'test-model' }); // user settings
    mockDb.run.mockResolvedValueOnce({ lastID: 10 }); // insert lesson
    runWorkerAgent.mockResolvedValueOnce(JSON.stringify({
      curriculum: [
        { title: 'Rust Setup', explanation: 'Setting up Rust compiler...', code_example: 'fn main() {}', exercise: 'Run rustc', test_instructions: 'Print Hello' }
      ]
    }));

    const res = await request(app).post('/api/academy/start').send({
      language: 'rust',
      topic: 'Learn variables'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.lessonId).toBe(10);
    expect(res.body.curriculum).toHaveLength(1);
    expect(mockDb.run).toHaveBeenCalled();
  });

  test('GET /api/academy/lessons returns user lessons', async () => {
    mockDb.all.mockResolvedValueOnce([
      { id: 1, language: 'rust', topic: 'Learn variables', status: 'active' }
    ]);

    const res = await request(app).get('/api/academy/lessons');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, language: 'rust', topic: 'Learn variables', status: 'active' }
    ]);
  });

  test('GET /api/academy/lessons/:id returns single lesson details', async () => {
    mockDb.get.mockResolvedValueOnce({
      id: 1,
      user_id: 1,
      language: 'rust',
      topic: 'Learn variables',
      curriculum: JSON.stringify([{ title: 'Lesson 1' }]),
      grades: '{}'
    });

    const res = await request(app).get('/api/academy/lessons/1');

    expect(res.status).toBe(200);
    expect(res.body.topic).toBe('Learn variables');
    expect(res.body.curriculum).toEqual([{ title: 'Lesson 1' }]);
  });

  test('POST /api/academy/lessons/:id/submit grades submission', async () => {
    mockDb.get
      .mockResolvedValueOnce({
        id: 1,
        user_id: 1,
        language: 'rust',
        topic: 'Learn variables',
        curriculum: JSON.stringify([{ title: 'Lesson 1', test_instructions: 'Print hello' }]),
        current_step_index: 0,
        grades: '{}'
      }) // lesson
      .mockResolvedValueOnce({ breaking_changes: '[]' }) // language updates
      .mockResolvedValueOnce({ provider: 'gemini' }); // user settings

    runWorkerAgent.mockResolvedValueOnce(JSON.stringify({
      score: 85,
      feedback: 'Good job!',
      is_correct: true
    }));

    mockDb.run.mockResolvedValueOnce({});

    const res = await request(app).post('/api/academy/lessons/1/submit').send({
      student_answer: 'fn main() { println!("hello"); }'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.grade.score).toBe(85);
    expect(res.body.status).toBe('completed'); // since it advances past index 0 (the only step)
  });

  test('POST /api/academy/lessons/:id/pause pauses lesson', async () => {
    mockDb.run.mockResolvedValueOnce({});

    const res = await request(app).post('/api/academy/lessons/1/pause');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/academy/lessons/:id/resume resumes lesson', async () => {
    mockDb.run.mockResolvedValueOnce({});

    const res = await request(app).post('/api/academy/lessons/1/resume');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
