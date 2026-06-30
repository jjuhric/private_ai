const { handleWeatherTool } = require('../tools/weather_tool');

// Mock db.js
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

// Mock global fetch
global.fetch = jest.fn();

describe('Weather Tool Tests', () => {
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

    // Seed test user with profile details
    const result = await db.run(`
      INSERT INTO users (username, password_hash, zipcode, country, temp_unit, weather_api_key)
      VALUES ('weatheruser', 'hashed', '32421', 'US', 'imperial', 'test_key')
    `);
    userId = result.lastID;
  });

  afterAll(async () => {
    if (db) {
      await db.close();
      mockTestDb = null;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('current action - geocodes and retrieves current weather successfully', async () => {
    // Mock 1: Geocoding zip lookup
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lat: 30.9254,
        lon: -85.1278,
        name: 'Calhoun County'
      })
    });

    // Mock 2: Current weather details
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        weather: [{ description: 'clear sky' }],
        main: {
          temp: 78.5,
          feels_like: 80.0,
          temp_min: 75.0,
          temp_max: 82.0,
          humidity: 65,
          pressure: 1016,
          sea_level: 1016,
          grnd_level: 1011
        },
        wind: { speed: 5.2 },
        rain: { '1h': 0.1 }
      })
    });

    const result = await handleWeatherTool(db, userId, 'current', {});
    expect(result).toContain('Current Weather Report for **Calhoun County**');
    expect(result).toContain('78.5°F');
    expect(result).toContain('Clear sky');
    expect(result).toContain('0.1 mm');
  });

  test('hourly action - falls back to standard forecast if pro endpoint fails', async () => {
    // Mock 1: Geocoding zip lookup
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lat: 30.9254,
        lon: -85.1278,
        name: 'Calhoun County'
      })
    });

    // Mock 2: Pro hourly forecast fails
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401
    });

    // Mock 3: Standard 5-day / 3-hour forecast fallback succeeds
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        list: [
          {
            dt: 1661875200,
            main: { temp: 77.0, feels_like: 78.2, humidity: 82 },
            weather: [{ description: 'broken clouds' }],
            wind: { speed: 4.2 },
            dt_txt: '2026-06-30 09:00:00'
          }
        ]
      })
    });

    const result = await handleWeatherTool(db, userId, 'hourly', {});
    expect(result).toContain('Hourly Weather Forecast for **Calhoun County**');
    expect(result).toContain('77°F');
    expect(result).toContain('broken clouds');
  });

  test('daily action - calculates daily values from standard 5-day forecast fallback', async () => {
    // Mock 1: Geocoding zip lookup
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lat: 30.9254,
        lon: -85.1278,
        name: 'Calhoun County'
      })
    });

    // Mock 2: Daily forecast fails (401)
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401
    });

    // Mock 3: Standard 5-day / 3-hour forecast fallback succeeds
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        list: [
          {
            dt: 1661875200,
            main: { temp: 80.0, temp_min: 75.0, temp_max: 85.0, humidity: 60 },
            weather: [{ description: 'clear sky' }],
            wind: { speed: 3.5 },
            clouds: { all: 10 },
            dt_txt: '2026-06-30 12:00:00'
          }
        ]
      })
    });

    const result = await handleWeatherTool(db, userId, 'daily', { cnt: 1 });
    expect(result).toContain('Daily Weather Forecast for **Calhoun County**');
    expect(result).toContain('80°F');
    expect(result).toContain('clear sky');
  });
});
