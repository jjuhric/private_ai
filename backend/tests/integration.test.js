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
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockImplementation(() => ({
      generateContent: jest.fn()
        // Turn 1: Request weather tool
        .mockResolvedValueOnce({
          response: {
            text: () => JSON.stringify({
              thought: 'The user wants weather details. I need to run the weather tool.',
              tool: 'weather',
              action: 'current',
              params: { zipcode: '32421', country: 'US' }
            })
          }
        })
        // Turn 2: Finish tool invocation
        .mockResolvedValueOnce({
          response: {
            text: () => JSON.stringify({
              thought: 'I have gathered the weather data. I am ready to respond.',
              tool: 'none',
              action: '',
              params: {}
            })
          }
        }),
      generateContentStream: jest.fn().mockResolvedValue({
        stream: [
          { text: () => 'The current weather in Calhoun County (32421, US) ' },
          { text: () => 'is sunny and 78°F.' }
        ]
      })
    }))
  }))
}));

// Route fetch mock calls by URL pattern
global.fetch = jest.fn().mockImplementation((url) => {
  const urlStr = typeof url === 'string' ? url : url.url || '';
  
  if (urlStr.includes('geo/1.0/zip')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ lat: 30.92, lon: -85.12, name: 'Calhoun County' })
    });
  }
  
  if (urlStr.includes('data/2.5/weather')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        weather: [{ description: 'sunny' }],
        main: { temp: 78, feels_like: 78, humidity: 50, pressure: 1013 },
        wind: { speed: 4.5 }
      })
    });
  }

  // Fail-safe default
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({})
  });
});

describe('Agent Coordinator Loop Integration Tests', () => {
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

    const userRes = await db.run(`
      INSERT INTO users (username, password_hash, zipcode, country, temp_unit, weather_api_key)
      VALUES ('integuser', 'hashed', '32421', 'US', 'imperial', 'test_key')
    `);
    userId = userRes.lastID;
  });

  afterAll(async () => {
    if (db) {
      await db.close();
      mockTestDb = null;
    }
  });

  test('executes a full multi-turn weather retrieval agent chain', async () => {
    const thoughts = [];
    const contents = [];
    const toolCalls = [];

    await runAgentLoop({
      db,
      userId,
      provider: 'online',
      modelName: 'gemini-2.5-flash',
      userMessage: 'is it hot in 32421?',
      history: [],
      onlineProvider: 'gemini',
      onlineKey: 'gemini_test_key',
      onThought: (t) => thoughts.push(t),
      onContent: (c) => contents.push(c),
      onToolCall: (tc) => toolCalls.push(tc)
    });

    // Verify thoughts collected
    expect(thoughts.length).toBeGreaterThanOrEqual(1);

    // Verify weather tool was called
    expect(toolCalls).toContainEqual({
      tool: 'weather',
      action: 'current',
      params: { zipcode: '32421', country: 'US' }
    });

    // Verify final content is returned
    const finalResponse = contents.join('');
    expect(finalResponse).toContain('The current weather in Calhoun County (32421, US) is sunny and 78°F.');
  });
});
