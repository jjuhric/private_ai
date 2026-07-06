const { runWorkerAgent } = require('../utils/agents');

describe('Agent Creator Agent Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('runWorkerAgent routes agent_creator_agent successfully', async () => {
    const settings = {
      provider: 'openai',
      modelName: 'gpt-4',
      workingDirectory: '/test/workspace'
    };

    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async (endpoint, options) => {
      callCount++;
      const body = JSON.parse(options.body);
      const prompt = body.messages ? body.messages[0].content : body.system_prompt;
      
      // Assert that prompt contains directories and instructions
      expect(prompt).toContain('Workspace System Directories');
      expect(prompt).toContain('Agent Creation Agent');

      if (callCount === 1) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  thought: 'I will write an Agent Plan for the calendar_specialist.',
                  tool: 'write_file',
                  action: 'write',
                  params: {
                    filePath: '/test/workspace/backend/utils/plans/agent_calendar_specialist_plan.md',
                    content: '# Agent Plan: Calendar Specialist\n\n- **Goal**: Help manage events\n- **Affects**: backend/utils/agents.js\n- **Risk**: Low\n- **Knowledge**: updates agents.js\n- **Files**: backend/utils/agents.js'
                  }
                })
              }
            }]
          })
        };
      }

      if (callCount === 2) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  thought: 'I have finished writing the plan.',
                  tool: 'none'
                })
              }
            }]
          })
        };
      }

      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{
            message: {
              content: 'Successfully designed the calendar specialist agent and wrote the plan.'
            }
          }]
        })
      };
    });

    const result = await runWorkerAgent('agent_creator_agent', settings, 'Create a calendar specialist agent', null, null, null);
    expect(result).toBeDefined();
    expect(callCount).toBe(3);
  });
});
