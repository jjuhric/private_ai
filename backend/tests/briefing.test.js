const { generateDailyBriefing } = require('../utils/briefing');

// Mock tools/weather_tool
jest.mock('../tools/weather_tool', () => ({
  handleWeatherTool: jest.fn().mockResolvedValue('Sunny and 75 degrees')
}));

// Mock ai
jest.mock('../ai', () => ({
  handleGoogleNewsTool: jest.fn().mockResolvedValue('Tech news: AI advances continue'),
  runAgentLoop: jest.fn()
}));

// Mock agents
jest.mock('../utils/agents', () => ({
  runWorkerAgent: jest.fn().mockResolvedValue({
    thought: 'Daily Briefing markdown content here.'
  })
}));

describe('Daily Briefing Generation Tests', () => {
  let mockDb;

  beforeEach(() => {
    // Simple inline db mock
    mockDb = {
      get: jest.fn().mockImplementation((query, params) => {
        if (query.includes('FROM users')) {
          return { id: 1, username: 'testuser', name: 'Test User', weather_api_key: 'enc_key', zipcode: '90210' };
        }
        if (query.includes('FROM user_settings')) {
          return { provider: 'gemini', model_name: 'gemini-2.5-flash' };
        }
        if (query.includes('FROM chats')) {
          return { id: 42, title: 'Daily Briefings' };
        }
        return null;
      }),
      all: jest.fn().mockImplementation((query, params) => {
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

  test('generateDailyBriefing runs and compiles weather, schedule, and news correctly', async () => {
    const result = await generateDailyBriefing(mockDb, 1);
    expect(result).toContain('Daily Briefing markdown content');
    expect(mockDb.get).toHaveBeenCalled();
    expect(mockDb.all).toHaveBeenCalled();
    expect(mockDb.run).toHaveBeenCalled();
  });
});
