const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

let mockDb = null;
let mockFetchResponses = {};
let mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => {
      return {
        getGenerativeModel: jest.fn().mockImplementation(() => {
          return {
            generateContent: mockGenerateContent
          };
        })
      };
    })
  };
});

jest.mock('../db', () => {
  return {
    getDb: async () => mockDb
  };
});

const { JWT_SECRET } = require('../middleware/auth');
const chatRouter = require('../routes/chat');
const app = express();
app.use(express.json());
app.use('/api', chatRouter);

describe('LM Studio and Model Selection Tests', () => {
  let token;
  const userId = 1;
  const chatId = 10;
  const originalFetch = global.fetch;

  beforeAll(() => {
    token = jwt.sign({ id: userId, username: 'testuser' }, JWT_SECRET);
  });

  beforeEach(() => {
    mockFetchResponses = {};
    global.fetch = jest.fn().mockImplementation(async (url, options = {}) => {
      const urlStr = url.toString();
      for (const pattern of Object.keys(mockFetchResponses)) {
        if (urlStr.includes(pattern)) {
          const handler = mockFetchResponses[pattern];
          return typeof handler === 'function' ? handler(urlStr, options) : handler;
        }
      }
      return { ok: true, json: async () => ({}) };
    });

    mockDb = {
      get: jest.fn().mockImplementation(async (query, params) => {
        if (query.includes('FROM chats')) {
          return { id: chatId };
        }
        if (query.includes('FROM user_settings')) {
          return {
            provider: 'local',
            model_name: 'preferred-local-model',
            local_url: 'http://localhost:1234/v1',
            local_key: 'encrypted-local-key'
          };
        }
        if (query.includes('FROM users')) {
          return { name: 'Test User' };
        }
        return null;
      }),
      all: jest.fn().mockResolvedValue([]),
      run: jest.fn().mockResolvedValue({ lastID: 1 })
    };
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('listLocalModels tries native /api/v1/models first, then falls back to /v1/models', async () => {
    const { listLocalModels } = require('../utils/lmstudio');
    
    // Set native endpoint to return 404, compat to return valid models
    mockFetchResponses['/api/v1/models'] = {
      ok: false,
      status: 404,
      text: async () => 'Not Found'
    };
    mockFetchResponses['/v1/models'] = {
      ok: true,
      json: async () => ({
        data: [{ id: 'model-compat-1' }]
      })
    };

    const models = await listLocalModels('http://localhost:1234/v1', 'key');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/models'), expect.any(Object));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/models'), expect.any(Object));
    expect(models).toEqual([{ id: 'model-compat-1', name: 'model-compat-1', isLoaded: false, instanceId: null }]);
  });

  test('loadLocalModel and unloadLocalModel make correct POST requests to native API', async () => {
    const { loadLocalModel, unloadLocalModel } = require('../utils/lmstudio');

    mockFetchResponses['/api/v1/models/load'] = {
      ok: true,
      json: async () => ({ status: 'loaded' })
    };
    mockFetchResponses['/api/v1/models/unload'] = {
      ok: true,
      json: async () => ({ status: 'unloaded' })
    };

    const loadRes = await loadLocalModel('http://localhost:1234/v1', 'key', 'model-1');
    expect(loadRes).toEqual({ status: 'loaded' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/models/load'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'model-1' })
      })
    );

    const unloadRes = await unloadLocalModel('http://localhost:1234/v1', 'key', 'instance-1');
    expect(unloadRes).toEqual({ status: 'unloaded' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/models/unload'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ instance_id: 'instance-1' })
      })
    );
  });

  test('selectBestModel local path runs selection query on currently loaded model', async () => {
    const { selectBestModel } = require('../utils/model_selector');

    mockFetchResponses['/api/v1/models'] = {
      ok: true,
      json: async () => ({
        models: [
          { id: 'model-1', loaded_instances: [{ instance_id: 'inst-1' }] },
          { id: 'model-2', loaded_instances: [] }
        ]
      })
    };

    mockFetchResponses['/chat/completions'] = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ selected_model: 'model-2', reasoning: 'better for coding' }) } }]
      })
    };

    const settings = {
      provider: 'local',
      modelName: 'model-1',
      localBaseUrl: 'http://localhost:1234/v1',
      localApiKey: 'key'
    };

    const selected = await selectBestModel(settings, 'write a react component', []);
    expect(selected).toBe('model-2');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"model-1"') // Runs on the currently loaded model
      })
    );
  });

  test('selectBestModel offline strict isolation check (does not contact Google/online APIs)', async () => {
    const { selectBestModel } = require('../utils/model_selector');

    mockFetchResponses['/api/v1/models'] = {
      ok: true,
      json: async () => ({
        models: [{ id: 'model-1', loaded_instances: [{ instance_id: 'inst-1' }] }]
      })
    };

    mockFetchResponses['/chat/completions'] = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ selected_model: 'model-1', reasoning: 'keep same' }) } }]
      })
    };

    const settings = {
      provider: 'local',
      modelName: 'model-1',
      localBaseUrl: 'http://localhost:1234/v1',
      localApiKey: 'key',
      onlineKey: 'online-key'
    };

    const selected = await selectBestModel(settings, 'test query', []);
    expect(selected).toBe('model-1');

    // Confirm that no googleapis.com or online endpoints were contacted
    const calls = global.fetch.mock.calls.map(c => c[0]);
    const onlineCalls = calls.filter(url => url.includes('googleapis.com') || url.includes('openai.com'));
    expect(onlineCalls.length).toBe(0);
  });

  test('selectBestModel online path calls Gemini and selects optimal online model', async () => {
    const { selectBestModel } = require('../utils/model_selector');

    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({ selected_model: 'gemini-2.5-pro', reasoning: 'complex logic' })
      }
    });

    const settings = {
      provider: 'online',
      onlineProvider: 'gemini',
      modelName: 'gemini-2.5-flash',
      onlineKey: 'test-api-key'
    };

    const selected = await selectBestModel(settings, 'design a database schema', []);
    expect(selected).toBe('gemini-2.5-pro');
    expect(mockGenerateContent).toHaveBeenCalled();
  });

  test('selectBestModel online path falls back to default when key is missing or call throws', async () => {
    const { selectBestModel } = require('../utils/model_selector');

    // Case 1: Missing Key
    const settingsNoKey = {
      provider: 'online',
      onlineProvider: 'gemini',
      modelName: 'gemini-2.5-flash'
    };
    const selected1 = await selectBestModel(settingsNoKey, 'hello', []);
    expect(selected1).toBe('gemini-2.5-flash');

    // Case 2: API Throws
    mockGenerateContent.mockRejectedValue(new Error('API quota exceeded'));
    const settingsError = {
      provider: 'online',
      onlineProvider: 'gemini',
      modelName: 'gemini-2.5-flash',
      onlineKey: 'test-api-key'
    };
    const selected2 = await selectBestModel(settingsError, 'hello', []);
    expect(selected2).toBe('gemini-2.5-flash');
  });

  test('LM Studio url formatting helpers handle custom host urls', async () => {
    const { listLocalModels } = require('../utils/lmstudio');
    mockFetchResponses['/api/v1/models'] = {
      ok: true,
      json: async () => ({ models: [] })
    };
    await listLocalModels('http://localhost:5000', 'key');
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:5000/api/v1/models', expect.any(Object));
  });

  test('loadLocalModel and unloadLocalModel throw error when HTTP response is not ok', async () => {
    const { loadLocalModel, unloadLocalModel } = require('../utils/lmstudio');

    mockFetchResponses['/api/v1/models/load'] = {
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    };
    mockFetchResponses['/api/v1/models/unload'] = {
      ok: false,
      status: 400,
      text: async () => 'Bad Request'
    };

    await expect(loadLocalModel('http://localhost:1234/v1', 'key', 'model-1')).rejects.toThrow('LM Studio HTTP 500: Internal Server Error');
    await expect(unloadLocalModel('http://localhost:1234/v1', 'key', 'instance-1')).rejects.toThrow('LM Studio HTTP 400: Bad Request');
  });

  test('selectBestModel local path falls back to loaded model when query throws or fails', async () => {
    const { selectBestModel } = require('../utils/model_selector');

    mockFetchResponses['/api/v1/models'] = {
      ok: true,
      json: async () => ({
        models: [{ id: 'model-1', loaded_instances: [{ instance_id: 'inst-1' }] }]
      })
    };

    mockFetchResponses['/chat/completions'] = jest.fn().mockRejectedValue(new Error('Connection timed out'));

    const settings = {
      provider: 'local',
      modelName: 'model-1',
      localBaseUrl: 'http://localhost:1234/v1',
      localApiKey: 'key'
    };

    const selected = await selectBestModel(settings, 'test query', []);
    expect(selected).toBe('model-1');
  });

  test('listLocalModels returns empty list when both native and compat endpoints fail', async () => {
    const { listLocalModels } = require('../utils/lmstudio');

    mockFetchResponses['/api/v1/models'] = jest.fn().mockRejectedValue(new Error('Native API down'));
    mockFetchResponses['/v1/models'] = jest.fn().mockRejectedValue(new Error('Compat API down'));

    const models = await listLocalModels('http://localhost:1234/v1', 'key');
    expect(models).toEqual([]);
  });

  test('selectBestModel local path falls back to keyword matching when response is not valid JSON', async () => {
    const { selectBestModel } = require('../utils/model_selector');

    mockFetchResponses['/api/v1/models'] = {
      ok: true,
      json: async () => ({
        models: [
          { id: 'model-1', loaded_instances: [{ instance_id: 'inst-1' }] },
          { id: 'model-2', loaded_instances: [] }
        ]
      })
    };

    mockFetchResponses['/chat/completions'] = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'This is not JSON but it mentions model-2' } }]
      })
    };

    const settings = {
      provider: 'local',
      modelName: 'model-1',
      localBaseUrl: 'http://localhost:1234/v1',
      localApiKey: 'key'
    };

    const selected = await selectBestModel(settings, 'test query', []);
    expect(selected).toBe('model-2');
  });
});
