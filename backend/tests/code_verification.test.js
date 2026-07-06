const { verifyCommandWithQAAndSupervisor } = require('../utils/codeVerifier');
const { handleCoderTool } = require('../tools/coder_tools');
const { runAgentLoop } = require('../ai');
const agents = require('../utils/agents');

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

jest.mock('../utils/agents', () => {
  const originalModule = jest.requireActual('../utils/agents');
  return {
    ...originalModule,
    runAgentTurn: jest.fn()
  };
});

describe('Code Execution Verification Tests', () => {
  let settings;

  beforeEach(() => {
    jest.clearAllMocks();
    settings = {
      provider: 'gemini',
      modelName: 'gemini-2.0-flash',
      onlineKey: 'test-key',
      geminiKey: 'test-key'
    };

    mockGenerateContentStream.mockResolvedValue({
      stream: (async function* () {
        yield { text: () => 'Final supervisor response.' };
      })(),
      response: Promise.resolve({
        usageMetadata: { totalTokenCount: 10 }
      })
    });
  });

  test('verifyCommandWithQAAndSupervisor returns correct results on approval', async () => {
    agents.runAgentTurn
      .mockResolvedValueOnce({
        params: {
          approved: true,
          can_cause_disruptions: false,
          reason: 'Command is safe'
        }
      }) // QA Review
      .mockResolvedValueOnce({
        params: {
          approved_without_user: true,
          can_cause_disruptions: false,
          reason: 'Supervisor approved'
        }
      }); // Supervisor Review

    const res = await verifyCommandWithQAAndSupervisor('echo hello', 'coder', settings);
    expect(res.qaResult.approved).toBe(true);
    expect(res.supervisorResult.approved_without_user).toBe(true);
    expect(res.supervisorResult.can_cause_disruptions).toBe(false);
  });

  test('verifyCommandWithQAAndSupervisor flags disruptive commands', async () => {
    agents.runAgentTurn
      .mockResolvedValueOnce({
        params: {
          approved: true,
          can_cause_disruptions: true,
          reason: 'May cause disruption'
        }
      }) // QA Review
      .mockResolvedValueOnce({
        params: {
          approved_without_user: false,
          can_cause_disruptions: true,
          reason: 'Supervisor requires HITL'
        }
      }); // Supervisor Review

    const res = await verifyCommandWithQAAndSupervisor('rm -rf /', 'coder', settings);
    expect(res.qaResult.approved).toBe(true);
    expect(res.supervisorResult.approved_without_user).toBe(false);
    expect(res.supervisorResult.can_cause_disruptions).toBe(true);
  });

  test('handleCoderTool execute_command returns INPUT_REQUIRED_FROM_USER on disruptive command', async () => {
    agents.runAgentTurn
      .mockResolvedValueOnce({
        params: {
          approved: true,
          can_cause_disruptions: true,
          reason: 'Modifies files'
        }
      }) // QA
      .mockResolvedValueOnce({
        params: {
          approved_without_user: false,
          can_cause_disruptions: true,
          reason: 'Requires user check'
        }
      }); // Supervisor

    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV; // temporarily remove test env check

    const options = {
      settings,
      agentName: 'coder'
    };

    const result = await handleCoderTool('execute_command', { command: 'npm install' }, options);
    
    process.env.NODE_ENV = originalNodeEnv; // restore

    expect(result).toContain('INPUT_REQUIRED_FROM_USER: [Supervisor Approval Required]');
    expect(result).toContain('Agent: coder');
    expect(result).toContain('Command: npm install');
  });

  test('runAgentLoop intercepts approved command response and executes it', async () => {
    const dbMock = {
      all: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(null),
      run: jest.fn().mockResolvedValue({ lastID: 1 })
    };

    const onContentMock = jest.fn();
    const onThoughtMock = jest.fn();

    const history = [
      { role: 'user', content: 'run safe command' },
      {
        role: 'assistant',
        content: `[Supervisor Approval Required]
Agent: coder
Command: echo approved
QA Analysis: Safe command
Supervisor Evaluation: Safe`
      }
    ];

    agents.runAgentTurn.mockResolvedValueOnce({
      thought: 'Execution complete',
      tool: 'none'
    });

    await runAgentLoop({
      db: dbMock,
      userId: 1,
      chatId: 1,
      userMessage: '1',
      history,
      provider: 'gemini',
      modelName: 'gemini-2.0-flash',
      onThought: onThoughtMock,
      onContent: onContentMock,
      onToolCall: jest.fn(),
      onAgentStatus: jest.fn(),
      abortSignal: null
    });

    expect(onThoughtMock).toHaveBeenCalledWith(expect.stringContaining('Executing...'));
  });

  test('runAgentLoop intercepts rejected command and asks why', async () => {
    const dbMock = {
      all: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(null),
      run: jest.fn().mockResolvedValue({ lastID: 1 })
    };

    const onContentMock = jest.fn();
    const onThoughtMock = jest.fn();

    const history = [
      { role: 'user', content: 'run npm install' },
      {
        role: 'assistant',
        content: `[Supervisor Approval Required]
Agent: coder
Command: npm install
QA Analysis: Modifies node modules
Supervisor Evaluation: Potential disruption`
      }
    ];

    await runAgentLoop({
      db: dbMock,
      userId: 1,
      chatId: 1,
      userMessage: '2',
      history,
      provider: 'gemini',
      modelName: 'gemini-2.0-flash',
      onThought: onThoughtMock,
      onContent: onContentMock,
      onToolCall: jest.fn(),
      onAgentStatus: jest.fn(),
      abortSignal: null
    });

    expect(onContentMock).toHaveBeenCalledWith('Why did you choose not to go forward with this code?');
    expect(dbMock.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messages'),
      expect.any(Array)
    );
  });
});
