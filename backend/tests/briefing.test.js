const { generateDailyBriefing, startBriefingScheduler } = require('../utils/briefing');
const { handleWeatherTool } = require('../tools/weather_tool');
const { runWorkerAgent } = require('../utils/agents');

// Mock weather_tool
jest.mock('../tools/weather_tool', () => ({
  handleWeatherTool: jest.fn()
}));

// Mock google_news_tool
jest.mock('../tools/google_news_tool', () => ({
  handleGoogleNewsTool: jest.fn()
}));

// Mock agents
jest.mock('../utils/agents', () => ({
  runWorkerAgent: jest.fn()
}));

// Mock crypto
jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn((val) => val ? val.replace('enc_', '') : '')
}));

describe('Daily Briefing Generation Tests', () => {
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockDb = {
      get: jest.fn().mockImplementation(async (query, params) => {
        if (query.includes('FROM users')) {
          return { id: 1, username: 'testuser', name: 'Test User', weather_api_key: 'enc_key', zipcode: '90210', temp_unit: 'celsius', country: 'CA' };
        }
        if (query.includes('FROM user_settings')) {
          return { provider: 'gemini', model_name: 'gemini-2.5-flash', preferred_online_model: 'custom-supervisor-model' };
        }
        if (query.includes('FROM chats')) {
          return { id: 42, title: 'Daily Briefings' };
        }
        return null;
      }),
      all: jest.fn().mockImplementation(async (query, params) => {
        if (query.includes('calendar_events')) {
          return [{ title: 'Meeting', start_time: '2026-07-04 10:00', description: 'Discuss code' }];
        }
        if (query.includes('memories')) {
          return [{ content: 'Likes dark mode' }];
        }
        return [];
      }),
      run: jest.fn().mockResolvedValue({ lastID: 100 })
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('generateDailyBriefing runs and compiles weather, schedule, and news correctly', async () => {
    handleWeatherTool.mockResolvedValueOnce('Sunny and 75 degrees');
    require('../tools/google_news_tool').handleGoogleNewsTool.mockResolvedValueOnce('Tech news: AI advances continue');
    runWorkerAgent.mockResolvedValueOnce({
      thought: 'Daily Briefing markdown content here.'
    });

    const result = await generateDailyBriefing(mockDb, 1);
    expect(result).toContain('Daily Briefing markdown content');
    expect(mockDb.get).toHaveBeenCalled();
    expect(mockDb.all).toHaveBeenCalled();
    expect(mockDb.run).toHaveBeenCalled();
  });

  test('generateDailyBriefing handles weather and news retrieval errors gracefully', async () => {
    handleWeatherTool.mockRejectedValueOnce(new Error('Weather API limit exceeded'));
    require('../tools/google_news_tool').handleGoogleNewsTool.mockRejectedValueOnce(new Error('News RSS parser failed'));
    runWorkerAgent.mockResolvedValueOnce({
      thought: 'Daily Briefing markdown content here.'
    });

    const result = await generateDailyBriefing(mockDb, 1);
    expect(result).toContain('Daily Briefing markdown content');
  });

  test('generateDailyBriefing creates Daily Briefings chat if it does not exist', async () => {
    handleWeatherTool.mockResolvedValueOnce('Sunny');
    require('../tools/google_news_tool').handleGoogleNewsTool.mockResolvedValueOnce('News');
    runWorkerAgent.mockResolvedValueOnce({
      thought: 'Briefing content'
    });

    // Make chats query return null the first time to simulate creation
    mockDb.get.mockImplementation(async (query, params) => {
      if (query.includes('FROM users')) {
        return { id: 1, username: 'testuser', name: 'Test User' };
      }
      if (query.includes('FROM user_settings')) {
        return { provider: 'gemini' };
      }
      if (query.includes('FROM chats')) {
        return null;
      }
      return null;
    });

    const result = await generateDailyBriefing(mockDb, 1);
    expect(result).toBe('Briefing content');
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO chats'),
      expect.any(Array)
    );
  });

  test('generateDailyBriefing handles overall failure throws', async () => {
    mockDb.get.mockRejectedValueOnce(new Error('Database lock error'));
    await expect(generateDailyBriefing(mockDb, 1)).rejects.toThrow('Database lock error');
  });

  test('startBriefingScheduler triggers daily briefing for eligible users', async () => {
    const mockUsers = [
      { id: 1, username: 'user1', briefing_hour: 7 },
      { id: 2, username: 'user2', briefing_hour: 8 }
    ];

    mockDb.all.mockResolvedValueOnce(mockUsers);
    
    // Stub generateDailyBriefing by spying/mocking it
    // To avoid importing/stubbing loop issues, we can check how mockDb gets called
    // First, let's mock generateDailyBriefing target internally
    mockDb.get.mockImplementation(async (query, params) => {
      if (query.includes('FROM users')) {
        return { id: 1, username: 'user1' };
      }
      if (query.includes('FROM user_settings')) {
        return { provider: 'gemini' };
      }
      return null;
    });
    runWorkerAgent.mockResolvedValueOnce({ thought: 'Briefing' });

    startBriefingScheduler(mockDb);
    
    // Advance timers by 5 minutes to trigger the interval
    await jest.advanceTimersByTimeAsync(300000);

    expect(mockDb.all).toHaveBeenCalledWith(
      expect.stringContaining('FROM users'),
      expect.any(Array)
    );
  });

  test('startBriefingScheduler handles scheduler database check error', async () => {
    mockDb.all.mockRejectedValueOnce(new Error('Scheduler checking failed'));

    startBriefingScheduler(mockDb);
    
    await jest.advanceTimersByTimeAsync(300000);
    // Should catch the error internally and not throw
    expect(mockDb.all).toHaveBeenCalled();
  });
});
