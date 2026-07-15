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
    get: jest.fn(),
    run: jest.fn()
  };
  return { getDb: jest.fn(() => Promise.resolve(mDb)) };
});

// Mock LM Studio utils
jest.mock('../utils/lmstudio', () => ({
  listLocalModels: jest.fn(),
  unloadLocalModel: jest.fn(),
  loadLocalModel: jest.fn()
}));

const lmstudioSwitchRouter = require('../routes/lmstudio_switch');
const academyRouter = require('../routes/academy');
const chatRouter = require('../routes/chat');
const dbModule = require('../db');
const lmstudioUtils = require('../utils/lmstudio');

const app = express();
app.use(express.json());
app.use('/api/settings', lmstudioSwitchRouter);
app.use('/api/academy', academyRouter);
app.use('/api', chatRouter);

describe('LM Studio Model & Tab Switch API', () => {
  let mockDb;

  beforeEach(async () => {
    mockDb = await dbModule.getDb();
    jest.clearAllMocks();
    global.activeTab = undefined;
  });

  test('POST /api/settings/active-tab sets global activeTab', async () => {
    const res = await request(app).post('/api/settings/active-tab').send({ tab: 'academy' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(global.activeTab).toBe('academy');
  });

  test('POST /api/settings/switch-model unloads and loads local models', async () => {
    mockDb.get.mockResolvedValueOnce({
      provider: 'local',
      local_key: 'encrypted-key',
      local_url: 'http://localhost:1234/v1'
    });

    lmstudioUtils.listLocalModels
      .mockResolvedValueOnce([
        { id: 'qwen2.5-coder-7b-instruct', isLoaded: true, instanceId: 'inst-qwen' },
        { id: 'google/gemma-4-e4b', isLoaded: false, instanceId: null }
      ])
      .mockResolvedValueOnce([
        { id: 'qwen2.5-coder-7b-instruct', isLoaded: false, instanceId: null },
        { id: 'google/gemma-4-e4b', isLoaded: false, instanceId: null }
      ]);

    lmstudioUtils.unloadLocalModel.mockResolvedValueOnce({ success: true });
    lmstudioUtils.loadLocalModel.mockResolvedValueOnce({ success: true });

    const res = await request(app).post('/api/settings/switch-model').send({ modelId: 'google/gemma-4-e4b' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(lmstudioUtils.unloadLocalModel).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'inst-qwen');
    expect(lmstudioUtils.loadLocalModel).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'google/gemma-4-e4b');
  });

  test('completions are blocked when on different tabs', async () => {
    // 1. Set tab to academy
    global.activeTab = 'academy';

    // 2. Mock DB for chat stream validation
    mockDb.get.mockResolvedValueOnce({ id: 1 }); // chat check
    
    // 3. Try to call chat stream - should reject with 403
    const chatRes = await request(app).post('/api/chat/stream').send({ chatId: 1, message: 'hello' });
    expect(chatRes.status).toBe(403);
    expect(chatRes.body.error).toContain('disabled while on another tab');

    // 4. Set tab to chat
    global.activeTab = 'chat';

    // 5. Try to call academy chat - should reject with 403
    const academyRes = await request(app).post('/api/academy/lessons/1/chat').send({ message: 'explain ownership' });
    expect(academyRes.status).toBe(403);
    expect(academyRes.body.error).toContain('disabled while on another tab');
  });
});
