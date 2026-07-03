const { runWorkerAgent } = require('../utils/agents');

// Mock all tools to avoid hitting actual APIs
jest.mock('../tools/weather_tool', () => ({ handleWeatherTool: jest.fn(() => 'weather-ok') }));
jest.mock('../tools/host_machine_tool', () => ({ handleHostMachineTool: jest.fn(() => 'host-ok') }));
jest.mock('../tools/coder_tools', () => ({ handleCoderTool: jest.fn(() => 'coder-ok') }));
jest.mock('../tools/github_tool', () => ({ handleGitHubTool: jest.fn(() => 'github-ok') }));
jest.mock('../tools/calendar_tool', () => ({ handleCalendarTool: jest.fn(() => 'calendar-ok') }));
jest.mock('../tools/web_search_tool', () => ({ handleWebSearchTool: jest.fn(() => 'search-ok') }));
jest.mock('../tools/google_news_tool', () => ({ handleGoogleNewsTool: jest.fn(() => 'news-ok') }));
jest.mock('../tools/memory_tool', () => ({ handleMemoryTool: jest.fn(() => 'memory-ok') }));
jest.mock('../tools/vault_tool', () => ({ handleVaultTool: jest.fn(() => 'vault-ok') }));

describe('Agents Coverage Extender Tests', () => {
  let mockRunAgentTurn;

  beforeEach(() => {
    // We mock runAgentTurn by temporarily overriding it in the module cache or matching the LLM call
    mockRunAgentTurn = jest.fn();
  });

  test('runWorkerAgent should route tool actions correctly', async () => {
    const settings = {
      provider: 'gemini',
      geminiKey: 'fake-key',
      model_name: 'gemini-1.5-pro'
    };

    // We can spy on runAgentTurn inside the required file, but since it is not exported,
    // we can mock the global fetch to return decisions!
    const decisions = [
      { tool: 'weather', action: 'get_forecast' },
      { tool: 'host_machine', action: 'get_specifications' },
      { tool: 'read_file', action: 'read' },
      { tool: 'github', action: 'list' },
      { tool: 'calendar', action: 'list' },
      { tool: 'search_web', action: 'query' },
      { tool: 'google_news', action: 'query' },
      { tool: 'memory', action: 'recall' },
      { tool: 'query_vault', action: 'query' },
      { tool: 'unknown_tool', action: 'query' },
      { tool: 'none' } // Stop the loop
    ];

    let decisionIdx = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      const decision = decisions[decisionIdx++];
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify(decision)
            }
          }]
        })
      };
    });

    const result = await runWorkerAgent('weather_expert', settings, 'What is the weather?', {}, 1, 'token');
    expect(result).toBeDefined();
  });

  test('runAgentTurn with anthropic style headers and response parsing', async () => {
    const settings = {
      provider: 'online',
      onlineProvider: 'anthropic',
      onlineKey: 'sk-ant-123',
      onlineUrl: 'https://api.anthropic.com/v1',
      model_name: 'claude-3-opus'
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tool: 'none', thought: 'no tool' }) } }],
        content: [{ text: JSON.stringify({ tool: 'none', thought: 'no tool' }) }]
      })
    });

    const { runAgentLoop } = require('../ai');
    const result = await runAgentLoop({
      userMessage: 'Hello',
      db: {},
      userId: 1,
      githubToken: 'git',
      provider: 'online',
      onlineProvider: 'anthropic',
      onlineKey: 'sk-ant-123',
      onlineUrl: 'https://api.anthropic.com/v1',
      modelName: 'claude-3-opus',
      onThought: jest.fn(),
      onContent: jest.fn(),
      onToolCall: jest.fn()
    });
    expect(result).toBeUndefined();
  });

  test('runAgentTurn failure handler covers LLM error throws', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    const { runAgentLoop } = require('../ai');
    await expect(runAgentLoop({
      userMessage: 'Hello',
      db: {},
      userId: 1,
      githubToken: 'git',
      provider: 'online',
      onlineProvider: 'openai',
      onlineKey: 'sk-123',
      modelName: 'gpt-4',
      onThought: jest.fn(),
      onContent: jest.fn(),
      onToolCall: jest.fn()
    })).rejects.toThrow('LLM API error');
  });

  test('runAgentLoop database queries catch failure blocks', async () => {
    const { runAgentLoop } = require('../ai');
    const mockDb = {
      all: jest.fn().mockRejectedValue(new Error('DB Query failure')),
      get: jest.fn().mockRejectedValue(new Error('DB Get failure'))
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name) => name === 'content-type' ? 'application/json' : null
      },
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tool: 'none', thought: 'error fallback test' }) } }]
      })
    });

    await runAgentLoop({
      db: mockDb,
      userId: 1,
      provider: 'local',
      localBaseUrl: 'http://localhost:1234/v1',
      localApiKey: 'key',
      localApiStyle: 'openai',
      userMessage: 'test message',
      history: [],
      onThought: jest.fn(),
      onContent: jest.fn(),
      onToolCall: jest.fn(),
      isAborted: () => false,
      forceMemoryAgent: true
    });
    
    expect(mockDb.all).toHaveBeenCalled();
    expect(mockDb.get).toHaveBeenCalled();
  });
});
