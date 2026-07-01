const { handleTimeTool } = require('../tools/time_tool');

describe('Time Tool Tests', () => {
  let mockDb;

  beforeAll(() => {
    mockDb = {
      get: jest.fn()
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('action current_time - returns formatted UTC time', async () => {
    const result = await handleTimeTool(null, null, 'current_time', {});
    expect(result).toContain('Current UTC Time:');
    expect(result).toContain('(ISO:');
  });

  test('action lookup_timezone - error if missing db or userId', async () => {
    const result = await handleTimeTool(null, null, 'lookup_timezone', { zipcode: '12345' });
    expect(result).toContain('Error: Database connection and User ID are required');
  });

  test('action lookup_timezone - error if missing zipcode', async () => {
    const result = await handleTimeTool(mockDb, 1, 'lookup_timezone', {});
    expect(result).toContain('Error: Zipcode is required');
  });

  test('action lookup_timezone - error if profile query fails', async () => {
    mockDb.get.mockRejectedValueOnce(new Error('DB Query Error'));
    const result = await handleTimeTool(mockDb, 1, 'lookup_timezone', { zipcode: '12345' });
    expect(result).toContain('Error: Failed to query user profile: DB Query Error');
  });

  test('action lookup_timezone - error if API key not configured', async () => {
    mockDb.get.mockResolvedValueOnce({ weather_api_key: '' });
    const result = await handleTimeTool(mockDb, 1, 'lookup_timezone', { zipcode: '12345' });
    expect(result).toContain('Error: OpenWeatherMap API Key is not configured');
  });

  test('action lookup_timezone - success path with mocked API calls', async () => {
    mockDb.get.mockResolvedValueOnce({ weather_api_key: 'mock_api_key' });
    
    const mockGeocodeResponse = {
      ok: true,
      json: async () => ({
        lat: 30.54,
        lon: -85.12,
        name: 'Altha'
      })
    };
    
    const mockWeatherResponse = {
      ok: true,
      json: async () => ({
        timezone: -18000
      })
    };
    
    const originalFetch = global.fetch;
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockGeocodeResponse)
      .mockResolvedValueOnce(mockWeatherResponse);

    try {
      const resultStr = await handleTimeTool(mockDb, 1, 'lookup_timezone', { zipcode: '32421' });
      const result = JSON.parse(resultStr);
      
      expect(result.success).toBe(true);
      expect(result.cityName).toBe('Altha');
      expect(result.latitude).toBe(30.54);
      expect(result.longitude).toBe(-85.12);
      expect(result.timezoneOffsetSeconds).toBe(-18000);
      expect(result.timezoneOffsetHours).toBe(-5);
      expect(result.timezoneFormatted).toBe('UTC-5');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('action lookup_timezone - API failure path', async () => {
    mockDb.get.mockResolvedValueOnce({ weather_api_key: 'mock_api_key' });
    
    const mockGeocodeResponse = {
      ok: false,
      status: 400
    };
    
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValueOnce(mockGeocodeResponse);

    try {
      const result = await handleTimeTool(mockDb, 1, 'lookup_timezone', { zipcode: '32421' });
      expect(result).toContain('Error: Timezone lookup failed: Geocoding failed with status 400');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('action unknown - returns error', async () => {
    const result = await handleTimeTool(null, null, 'unknown_action', {});
    expect(result).toContain('Error: Unknown action');
  });
});
