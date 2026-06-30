const { handleWeatherTool } = require('../tools/weather_tool');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

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

  test('error path - geocoding fails', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
    const result = await handleWeatherTool(db, userId, 'current', { zipcode: '00000' });
    expect(result).toContain('Error: Failed to resolve coordinates');
  });

  test('error path - hourly fallback fails', async () => {
    // Mock 1: Geocoding succeeds
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ lat: 10, lon: 10, name: 'FailedCity' })
    });
    // Mock 2: Pro API fails
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    // Mock 3: Standard fallback fails too
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Bad Request' });

    const result = await handleWeatherTool(db, userId, 'hourly', {});
    expect(result).toContain('Failed to fetch hourly forecast');
  });

  test('error path - daily fallback fails', async () => {
    // Mock 1: Geocoding succeeds
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ lat: 10, lon: 10, name: 'FailedCity' })
    });
    // Mock 2: Daily API fails
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    // Mock 3: Standard fallback fails
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await handleWeatherTool(db, userId, 'daily', {});
    expect(result).toContain('Failed to fetch daily forecast');
  });

  test('error path - missing api key', async () => {
    const userRes = await db.run("INSERT INTO users (username, password_hash) VALUES ('nokeyuser', 'hashed')");
    const noKeyId = userRes.lastID;

    const result = await handleWeatherTool(db, noKeyId, 'current', {});
    expect(result).toContain('OpenWeatherMap API Key is not configured');
  });

  test('error path - missing zipcode but has key', async () => {
    const userRes = await db.run("INSERT INTO users (username, password_hash, weather_api_key) VALUES ('nozipuser', 'hashed', 'test_key')");
    const noZipId = userRes.lastID;

    const result = await handleWeatherTool(db, noZipId, 'current', {});
    expect(result).toContain('Zipcode is not configured');
  });

  test('error path - db or userId missing', async () => {
    const res1 = await handleWeatherTool(null, userId, 'current', {});
    expect(res1).toContain('Database connection and User ID are required');

    const res2 = await handleWeatherTool(db, null, 'current', {});
    expect(res2).toContain('Database connection and User ID are required');
  });

  test('error path - db query failure', async () => {
    const brokenDb = {
      get: jest.fn().mockRejectedValueOnce(new Error('Query error'))
    };
    const result = await handleWeatherTool(brokenDb, userId, 'current', {});
    expect(result).toContain('Failed to query user profile details: Query error');
  });

  test('error path - current weather fetch fails', async () => {
    // Geocode succeeds
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ lat: 10, lon: 10, name: 'FailedFetchCity' })
    });
    // Weather fetch returns ok: false
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request'
    });

    const result = await handleWeatherTool(db, userId, 'current', {});
    expect(result).toContain('Failed to query current weather: Current weather API returned status 400');
  });
});
