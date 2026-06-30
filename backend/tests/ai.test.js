const { runAgentLoop } = require('../ai');

// Mock SQLite db.js
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

// Mock Google Generative AI SDK
const mockGenerateContent = jest.fn();
const mockGenerateContentStream = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockImplementation(() => ({
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream
    }))
  }))
}));

// Route global fetch mock calls dynamically by URL matching
let routerDecisions = [];
let routerCallIndex = 0;
let forceRouterFormatError = false;
let forceResponderError = false;

global.fetch = jest.fn().mockImplementation((url, options) => {
  const urlStr = String(url || '');

  // 1. Router or Responder LLM Endpoint Matches
  if (urlStr.includes('/chat/completions') || urlStr.includes('/v1/messages') || urlStr.includes('/api/v1/chat') || urlStr.includes('1234')) {
    const isStreaming = options && options.body && JSON.parse(options.body).stream === true;
    const isRouter = !isStreaming;
    
    if (isRouter) {
      if (forceRouterFormatError) {
        forceRouterFormatError = false; // clear flag for retry
        return Promise.resolve({
          ok: false,
          status: 400,
          text: async () => 'response_format not supported',
          headers: { get: () => 'text/plain' }
        });
      }
      
      const decision = routerDecisions[routerCallIndex++] || {
        thought: 'No tool.',
        tool: 'none',
        action: '',
        params: {}
      };
      
      const isAnthropic = urlStr.includes('/v1/messages');
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => {
          if (isAnthropic) {
            return {
              content: [{ text: typeof decision === 'string' ? decision : JSON.stringify(decision) }]
            };
          }
          return {
            choices: [{
              message: {
                content: typeof decision === 'string' ? decision : JSON.stringify(decision)
              }
            }]
          };
        }
      });
    } else {
      // Responder Stream/JSON response
      if (forceResponderError) {
        return Promise.resolve({
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
          headers: { get: () => 'text/plain' }
        });
      }

      const isAnthropic = urlStr.includes('/v1/messages');
      if (isAnthropic) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            content: [{ text: 'Anthropic responder output.' }]
          })
        });
      }

      // Standard OpenAI event stream
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi responder output."}}]}\n\ndata: [DONE]\n'));
          controller.close();
        }
      });

      return Promise.resolve({
        ok: true,
        headers: {
          get: (h) => h === 'content-type' ? 'text/event-stream' : null
        },
        body: {
          getReader: () => mockStream.getReader()
        }
      });
    }
  }

  // 2. Weather Tool Coordinates
  if (urlStr.includes('geo/1.0/zip')) {
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ lat: 30.92, lon: -85.12, name: 'Calhoun County' })
    });
  }

  // 3. Weather Tool Details
  if (urlStr.includes('data/2.5/weather')) {
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        weather: [{ description: 'sunny' }],
        main: { temp: 70 },
        wind: { speed: 1 }
      })
    });
  }

  // 4. GitHub API
  if (urlStr.includes('api.github.com')) {
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => []
    });
  }

  // 5. DuckDuckGo Search Scraper
  if (urlStr.includes('duckduckgo.com')) {
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => '<html></html>'
    });
  }

  // 6. Google News RSS feed
  if (urlStr.includes('news.google.com')) {
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/xml' },
      text: async () => '<rss></rss>'
    });
  }

  // Fail-safe crawler/page crawl output
  return Promise.resolve({
    ok: true,
    headers: { get: () => 'text/html' },
    json: async () => ({}),
    text: async () => '<html><body>Page text</body></html>'
  });
});

describe('Agent Loop & LLM Stream Unit Tests', () => {
  let db;
  let userId;

  beforeAll(async () => {
    const { open } = require('sqlite');
    const sqlite3 = require('sqlite3');
    const fs = require('fs');
    const path = require('path');

    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });
    mockTestDb = db;
    const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
    await db.exec(schemaSql);

    // Seed user with zipcode/country to ensure weather tool executes fetches
    const userRes = await db.run(`
      INSERT INTO users (username, password_hash, zipcode, country, temp_unit, weather_api_key) 
      VALUES ('aiuser', 'hashed', '32421', 'US', 'imperial', 'test_key')
    `);
    userId = userRes.lastID;
  });

  afterAll(async () => {
    if (db) {
      await db.close();
      mockTestDb = null;
    }
  });

  beforeEach(() => {
    routerDecisions = [];
    routerCallIndex = 0;
    forceRouterFormatError = false;
    forceResponderError = false;
    jest.clearAllMocks();
  });

  test('runAgentLoop - Local LLM style with retry on response_format failure', async () => {
    forceRouterFormatError = true;
    routerDecisions = [
      {
        thought: 'No tool needed.',
        tool: 'none',
        action: '',
        params: {}
      }
    ];

    const thoughts = [];
    const contents = [];

    await runAgentLoop({
      db,
      userId,
      provider: 'local',
      modelName: 'google/gemma-4-e4b',
      userMessage: 'Hello',
      history: [],
      localApiKey: 'test_key',
      onThought: (t) => thoughts.push(t),
      onContent: (c) => contents.push(c),
      onToolCall: jest.fn()
    });

    expect(contents.join('')).toBe('Hi responder output.');
  });

  test('runAgentLoop - Anthropic style provider path', async () => {
    routerDecisions = [
      {
        thought: 'Run weather tool.',
        tool: 'weather',
        action: 'current',
        params: { zipcode: '32421', country: 'US' }
      },
      {
        thought: 'Finish.',
        tool: 'none',
        action: '',
        params: {}
      }
    ];

    const contents = [];
    await runAgentLoop({
      db,
      userId,
      provider: 'online',
      modelName: 'claude-3-sonnet',
      userMessage: 'Weather please',
      history: [{ role: 'assistant', content: 'previous response' }],
      onlineUrl: 'https://api.anthropic.com',
      onlineProvider: 'anthropic',
      onlineKey: 'anthropic_key',
      onThought: jest.fn(),
      onContent: (c) => contents.push(c),
      onToolCall: jest.fn()
    });

    expect(contents.join('')).toBe('Anthropic responder output.');
  });

  test('runAgentLoop - router parser fallback on malformed response', async () => {
    routerDecisions = [
      'Malformed plain text response that fails JSON parsing'
    ];

    const contents = [];
    await runAgentLoop({
      db,
      userId,
      provider: 'local',
      modelName: 'gemma',
      userMessage: 'Query',
      history: [],
      onThought: jest.fn(),
      onContent: (c) => contents.push(c),
      onToolCall: jest.fn()
    });

    expect(contents.join('')).toBe('Hi responder output.');
  });

  test('runAgentLoop - executes multi-tool routing turns and markdown code blocks', async () => {
    routerDecisions = [
      '```json\n{\n  "thought": "I will check git repositories",\n  "tool": "github",\n  "action": "list_repos",\n  "params": {}\n}\n```',
      {
        thought: 'I will check calendar',
        tool: 'calendar',
        action: 'list',
        params: { date: '2026-06-30' }
      },
      {
        thought: 'I will search web',
        tool: 'search_web',
        action: 'search',
        params: { query: 'Cowboys' }
      },
      {
        thought: 'I will check google news',
        tool: 'google_news',
        action: 'list',
        params: { query: 'Gemma' }
      },
      {
        thought: 'All done.',
        tool: 'none',
        action: '',
        params: {}
      }
    ];

    const contents = [];
    await runAgentLoop({
      db,
      userId,
      provider: 'local',
      modelName: 'gemma',
      userMessage: 'Git and calendar news',
      history: [],
      onThought: jest.fn(),
      onContent: (c) => contents.push(c),
      onToolCall: jest.fn()
    });

    expect(contents.join('')).toBe('Hi responder output.');
  });

  test('callLocalLLMStream - handles custom URL patterns and endpoint failures', async () => {
    forceResponderError = true;
    routerDecisions = [
      {
        thought: 'Finish.',
        tool: 'none',
        action: '',
        params: {}
      }
    ];

    await expect(
      runAgentLoop({
        db,
        userId,
        provider: 'local',
        modelName: 'error-model',
        userMessage: 'Query',
        history: [],
        localApiKey: 'lm-studio',
        onThought: jest.fn(),
        onContent: jest.fn(),
        onToolCall: jest.fn()
      })
    ).rejects.toThrow('Service Unavailable');
  });
});
