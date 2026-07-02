// Mock @google/generative-ai before imports
jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => {
      return {
        getGenerativeModel: jest.fn()
      };
    })
  };
});

let shouldDiskFail = false;
let shouldPowerFail = false;
let shouldTempFail = false;

// Link shouldPowerFail to global to be safely accessible in hoisted jest.mock
Object.defineProperty(global, 'shouldPowerFail', {
  get: () => shouldPowerFail,
  set: (val) => { shouldPowerFail = val; },
  configurable: true
});

Object.defineProperty(global, 'shouldTempFail', {
  get: () => shouldTempFail,
  set: (val) => { shouldTempFail = val; },
  configurable: true
});

jest.mock('../tools/ina219_tool', () => {
  return {
    measurePower: jest.fn().mockImplementation(async () => {
      if (global.shouldPowerFail) {
        throw new Error('Power script execution failed');
      }
      return {
        success: true,
        simulated: true,
        readings: [
          { battery_percent: 85.5, power_w: 2.45, voltage_v: 12.08, current_a: 0.203 },
          { battery_percent: 85.5, power_w: 2.45, voltage_v: 12.08, current_a: 0.203 },
          { battery_percent: 85.5, power_w: 2.45, voltage_v: 12.08, current_a: 0.203 }
        ],
        average: {
          battery_percent: 85.5,
          power_w: 2.45,
          voltage_v: 12.08,
          current_a: 0.203
        }
      };
    })
  };
});

jest.mock('../tools/temp_tool', () => {
  return {
    measureCpuTemp: jest.fn().mockImplementation(async () => {
      if (global.shouldTempFail) {
        throw new Error('Temp sensor execution failed');
      }
      return {
        success: true,
        simulated: true,
        readings: [
          { celsius: 42.5, fahrenheit: 108.5 },
          { celsius: 42.5, fahrenheit: 108.5 },
          { celsius: 42.5, fahrenheit: 108.5 }
        ],
        average: {
          celsius: 42.5,
          fahrenheit: 108.5
        }
      };
    })
  };
});

// Mock child_process.exec before requiring modules
const customPromisify = (cmd, opts) => {
  return new Promise((resolve, reject) => {
    if (shouldDiskFail && (cmd.includes('Get-PSDrive') || cmd.includes('df -h'))) {
      reject(new Error('Disk check failed'));
      return;
    }
    if (shouldPowerFail && cmd.includes('ina219_read.py')) {
      reject(new Error('Power script execution failed'));
      return;
    }
    if (cmd.includes('invalid_cmd')) {
      const err = new Error('Command execution failed');
      err.code = 127;
      err.stdout = 'some stdout';
      err.stderr = 'some stderr';
      reject(err);
    } else if (cmd.includes('Get-PSDrive')) {
      resolve({
        stdout: JSON.stringify([{ Name: 'C', Used: 50 * 1024 ** 3, Free: 150 * 1024 ** 3 }]),
        stderr: ''
      });
    } else if (cmd.includes('df -h')) {
      resolve({ stdout: 'df -h output', stderr: '' });
    } else if (cmd.includes('ina219_read.py')) {
      resolve({
        stdout: JSON.stringify({
          success: true,
          battery_percent: 85.5,
          power_w: 2.45,
          voltage_v: 12.08,
          current_a: 0.203
        }),
        stderr: ''
      });
    } else {
      resolve({ stdout: 'Command output', stderr: '' });
    }
  });
};

jest.mock('child_process', () => {
  const execMock = jest.fn((cmd, opts, callback) => {
    const cb = typeof opts === 'function' ? opts : callback;
    cb(null, 'Command output', '');
  });
  execMock[Symbol.for('nodejs.util.promisify.custom')] = customPromisify;
  return { exec: execMock };
});

const { handleHostMachineTool } = require('../tools/host_machine_tool');
const { handleCoderTool } = require('../tools/coder_tools');
const { handleWeatherTool } = require('../tools/weather_tool');
const { runAgentTurn, runWorkerAgent } = require('../utils/agents');
const { runAgentLoop } = require('../ai');
const fs = require('fs');
const path = require('path');

describe('Multi-Agent System & Tools Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Host Machine Tool', () => {
    test('retrieves host details successfully on win32', async () => {
      const os = require('os');
      const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('win32');
      const result = await handleHostMachineTool('get_specifications');
      expect(result).toContain('Host Machine Specifications');
      expect(result).toContain('Drive C');
      platformSpy.mockRestore();
    });

    test('host_machine_tool on non-win32 platform', async () => {
      const os = require('os');
      const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('linux');
      const result = await handleHostMachineTool('get_specifications');
      expect(result).toContain('Host Machine Specifications');
      expect(result).toContain('df -h');
      platformSpy.mockRestore();
    });

    test('host_machine_tool handles disk info retrieval failure', async () => {
      const os = require('os');
      const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('linux');
      shouldDiskFail = true;
      const result = await handleHostMachineTool('get_specifications');
      expect(result).toContain('Failed to retrieve disk info');
      shouldDiskFail = false;
      platformSpy.mockRestore();
    });

    test('host_machine_tool handles total system error', async () => {
      const os = require('os');
      const memSpy = jest.spyOn(os, 'totalmem').mockImplementation(() => {
        throw new Error('Total memory error');
      });
      const result = await handleHostMachineTool('get_specifications');
      expect(result).toContain('Error retrieving host machine specifications: Total memory error');
      memSpy.mockRestore();
    });

    test('host_machine_tool get_power retrieves battery details', async () => {
      const result = await handleHostMachineTool('get_power');
      expect(result).toContain('Power & Battery Status');
      expect(result).toContain('85.5%');
      expect(result).toContain('2.45 W');
    });

    test('host_machine_tool get_power handles python execution failures gracefully', async () => {
      shouldPowerFail = true;
      const result = await handleHostMachineTool('get_power');
      expect(result).toContain('Failed to read power telemetry');
      shouldPowerFail = false;
    });

    test('host_machine_tool get_temperature retrieves CPU temperature details', async () => {
      const result = await handleHostMachineTool('get_temperature');
      expect(result).toContain('CPU Temperature');
      expect(result).toContain('42.5°C');
      expect(result).toContain('108.5°F');
    });

    test('host_machine_tool get_temperature handles failures gracefully', async () => {
      shouldTempFail = true;
      const result = await handleHostMachineTool('get_temperature');
      expect(result).toContain('Failed to read CPU temperature');
      shouldTempFail = false;
    });
  });

  describe('Coder Tools', () => {
    test('read_file returns file contents or error', async () => {
      const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true });
      const readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue('console.log("hello");');

      const result = await handleCoderTool('read_file', { filePath: 'test.js' });
      expect(result).toContain('console.log("hello");');

      // Test validation error
      const errRes = await handleCoderTool('read_file', {});
      expect(errRes).toContain('Error: "filePath" parameter is required.');

      existsSpy.mockRestore();
      statSpy.mockRestore();
      readSpy.mockRestore();
    });

    test('write_file writes content successfully', async () => {
      const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const result = await handleCoderTool('write_file', { filePath: 'test.js', content: 'test content' });
      expect(result).toContain('Successfully wrote content');

      const errRes = await handleCoderTool('write_file', {});
      expect(errRes).toContain('Error: "filePath" parameter is required.');

      existsSpy.mockRestore();
      writeSpy.mockRestore();
    });

    test('list_dir lists directory details', async () => {
      const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true, isFile: () => false });
      const readdirSpy = jest.spyOn(fs, 'readdirSync').mockReturnValue(['file1.txt']);

      const result = await handleCoderTool('list_dir', { dirPath: '.' });
      expect(result).toContain('file1.txt');

      existsSpy.mockRestore();
      statSpy.mockRestore();
      readdirSpy.mockRestore();
    });

    test('execute_command runs command', async () => {
      const result = await handleCoderTool('execute_command', { command: 'node -v' });
      expect(result).toContain('Command output');

      const errRes = await handleCoderTool('execute_command', {});
      expect(errRes).toContain('Error: "command" parameter is required.');
    });

    test('safe path traversal check throws error', async () => {
      const result = await handleCoderTool('read_file', { filePath: '../outside/workspace.js' });
      expect(result).toContain('Access denied');
    });
  });

  describe('Weather Tool One Call', () => {
    test('onecall action returns One Call report', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ lat: 30.5, lon: -85.1, name: 'Altha' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            current: { temp: 75, feels_like: 76, humidity: 80, wind_speed: 5, weather: [{ description: 'sunny' }] },
            daily: [{ dt: 1719830400, temp: { day: 80, night: 65 }, weather: [{ description: 'partly cloudy' }] }]
          })
        });

      const mockDb = {
        get: jest.fn().mockResolvedValue({
          zipcode: '32421',
          country: 'US',
          temp_unit: 'imperial',
          weather_api_key: 'testkey'
        })
      };

      const result = await handleWeatherTool(mockDb, 1, 'onecall', { zipcode: '32421' });
      expect(result).toContain('OpenWeatherMap One Call API Report');
      expect(result).toContain('Altha');
      expect(result).toContain('75°F');

      global.fetch = globalFetch;
    });
  });

  describe('Agents Utility & Orchestration', () => {
    test('runWorkerAgent invokes specified worker loop and returns response report', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ thought: 'Deciding to finish', tool: 'none' }) } }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{ message: { content: 'Worker agent response summary.' } }]
          })
        });

      const result = await runWorkerAgent('host_specialist', { provider: 'openai', modelName: 'gpt-4' }, 'Check specs', null, 1);
      expect(result).toBe('Worker agent response summary.');

      global.fetch = globalFetch;
    });
  });

  describe('Supervisor Agent Integration (ai.js)', () => {
    test('runAgentLoop delegates to worker agent and creates final output', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ thought: 'Delegating weather task', tool: 'delegate_to_weather_expert', params: { task: 'get weather for Altha' } }) } }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ thought: 'Done now', tool: 'none' }) } }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{ message: { content: 'Weather is sunny and 75 degrees.' } }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ thought: 'Summary complete', tool: 'none' }) } }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            choices: [{ message: { content: 'Here is the summary: Weather is sunny and 75 degrees.' } }]
          })
        });

      const mockThought = jest.fn();
      const mockContent = jest.fn();
      const mockToolCall = jest.fn();

      await runAgentLoop({
        provider: 'openai',
        modelName: 'gpt-4',
        userMessage: 'What is the weather today?',
        history: [],
        onThought: mockThought,
        onContent: mockContent,
        onToolCall: mockToolCall
      });

      expect(mockThought).toHaveBeenCalled();
      expect(mockContent).toHaveBeenCalledWith('Here is the summary: Weather is sunny and 75 degrees.');
      expect(mockToolCall).toHaveBeenCalledWith(expect.objectContaining({ tool: 'delegate_to_weather_expert' }));

      global.fetch = globalFetch;
    });

    test('runAgentLoop supervisor with gemini provider', async () => {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const mockModel = {
        generateContent: jest.fn().mockResolvedValue({
          response: { text: () => JSON.stringify({ thought: 'gemini loop done', tool: 'none' }) }
        }),
        generateContentStream: jest.fn().mockResolvedValue({
          stream: (async function* () {
            yield { text: () => 'Stream content' };
          })()
        })
      };
      GoogleGenerativeAI.mockImplementation(() => ({
        getGenerativeModel: () => mockModel
      }));

      const mockThought = jest.fn();
      const mockContent = jest.fn();
      const mockToolCall = jest.fn();

      await runAgentLoop({
        provider: 'gemini',
        geminiKey: 'key',
        modelName: 'gemini-2.5-flash',
        userMessage: 'What is the weather today?',
        history: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
        onThought: mockThought,
        onContent: mockContent,
        onToolCall: mockToolCall
      });

      expect(mockContent).toHaveBeenCalledWith('Stream content');
    });
  });

  describe('Agent Coverage Extensions', () => {
    test('read_file validation when path is a directory', async () => {
      const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => false });
      const result = await handleCoderTool('read_file', { filePath: 'some_dir' });
      expect(result).toContain('is a directory, not a file');
      existsSpy.mockRestore();
      statSpy.mockRestore();
    });

    test('list_dir validation when path is not a directory', async () => {
      const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => false });
      const result = await handleCoderTool('list_dir', { dirPath: 'file.txt' });
      expect(result).toContain('is a file, not a directory');
      existsSpy.mockRestore();
      statSpy.mockRestore();
    });

    test('execute_command execution failure', async () => {
      const result = await handleCoderTool('execute_command', { command: 'invalid_cmd' });
      expect(result).toContain('Command execution failed');
    });

    test('unknown coding tool action', async () => {
      const result = await handleCoderTool('invalid_action', {});
      expect(result).toContain('Error: Unknown coding/QA tool action');
    });

    test('runWorkerAgent routes other tools (calendar, github, search_web, google_news)', async () => {
      const globalFetch = global.fetch;
      let calls = 0;
      global.fetch = jest.fn().mockImplementation((url) => {
        const urlStr = url || '';
        // Only count/mock LLM completion endpoint calls
        if (urlStr.includes('chat/completions') || urlStr.includes('completions')) {
          calls++;
          if (calls === 1) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Calling calendar', tool: 'calendar', action: 'list', params: { date: '2026-07-02' } }) } }] })
            });
          } else if (calls === 2) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Calling github', tool: 'github', action: 'list_repos', params: {} }) } }] })
            });
          } else if (calls === 3) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Searching web', tool: 'search_web', params: { query: 'test' } }) } }] })
            });
          } else if (calls === 4) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Checking news', tool: 'google_news', params: { query: 'test' } }) } }] })
            });
          } else if (calls === 5) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Finishing', tool: 'none' }) } }] })
            });
          } else {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: 'Combined report' } }] })
            });
          }
        }

        // Return empty/ok mock for other requests (like web search / geocoding)
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ choices: [], results: [] })
        });
      });

      const mockDb = {
        all: jest.fn().mockResolvedValue([]),
        get: jest.fn().mockResolvedValue(null)
      };

      const result = await runWorkerAgent('calendar_handler', { provider: 'openai', modelName: 'gpt-4' }, 'Manage calendar', mockDb, 1, 'token');
      expect(result).toContain('Combined report');
      global.fetch = globalFetch;
    });

    test('runAgentTurn with anthropic style', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ content: [{ text: JSON.stringify({ thought: 'anthropic done', tool: 'none' }) }] })
      });
      const result = await runAgentTurn('supervisor', 'system prompt', { provider: 'online', onlineProvider: 'anthropic', onlineUrl: 'http://anthropic' }, 'hello', []);
      expect(result.thought).toBe('anthropic done');
      global.fetch = globalFetch;
    });

    test('runAgentTurn with lm-studio style', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'lm done', tool: 'none' }) } }] })
      });
      const result = await runAgentTurn('supervisor', 'system prompt', { provider: 'local', localApiStyle: 'lm-studio', localBaseUrl: 'http://lm-studio' }, 'hello', []);
      expect(result.thought).toBe('lm done');
      global.fetch = globalFetch;
    });

    test('runAgentTurn with gemini provider', async () => {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const mockEmbed = {
        generateContent: jest.fn().mockResolvedValue({
          response: { text: () => JSON.stringify({ thought: 'gemini done', tool: 'none' }) }
        })
      };
      GoogleGenerativeAI.mockImplementation(() => ({
        getGenerativeModel: () => mockEmbed
      }));

      const result = await runAgentTurn('supervisor', 'system prompt', { provider: 'gemini', geminiKey: 'key' }, 'hello', []);
      expect(result.thought).toBe('gemini done');
    });

    test('coder_tools write_file with missing content', async () => {
      const result = await handleCoderTool('write_file', { filePath: 'test.js' });
      expect(result).toContain('Error: "content" parameter is required.');
    });

    test('coder_tools write_file write error', async () => {
      const result = await handleCoderTool('write_file', { filePath: '/', content: '' });
      expect(result).toContain('Error writing file');
    });

    test('coder_tools list_dir directory not found error', async () => {
      const result = await handleCoderTool('list_dir', { dirPath: 'nonexistent_dir_123' });
      expect(result).toContain('Directory not found');
    });

    test('runAgentResponse with gemini provider', async () => {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const mockModel = {
        generateContent: jest.fn()
          .mockResolvedValueOnce({
            response: { text: () => JSON.stringify({ thought: 'done', tool: 'none' }) }
          })
          .mockResolvedValueOnce({
            response: { text: () => 'gemini report summary' }
          })
      };
      GoogleGenerativeAI.mockImplementation(() => ({
        getGenerativeModel: () => mockModel
      }));

      const { runWorkerAgent } = require('../utils/agents');
      const result = await runWorkerAgent('host_specialist', { provider: 'gemini', geminiKey: 'key' }, 'hello', null, 1);
      expect(result).toBe('gemini report summary');
    });

    test('runAgentResponse with local lm-studio provider', async () => {
      const { runWorkerAgent } = require('../utils/agents');
      const globalFetch = global.fetch;
      let calls = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'done', tool: 'none' }) } }] })
          });
        } else {
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: 'lm-studio report summary' } }] })
          });
        }
      });

      const result = await runWorkerAgent('host_specialist', { provider: 'local', localApiStyle: 'lm-studio', localBaseUrl: 'http://localhost' }, 'hello', null, 1);
      expect(result).toBe('lm-studio report summary');
      global.fetch = globalFetch;
    });

    test('runAgentResponse with local anthropic provider', async () => {
      const { runWorkerAgent } = require('../utils/agents');
      const globalFetch = global.fetch;
      let calls = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ content: [{ text: JSON.stringify({ thought: 'done', tool: 'none' }) }] })
          });
        } else {
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ content: [{ text: 'anthropic report summary' }] })
          });
        }
      });

      const result = await runWorkerAgent('host_specialist', { provider: 'local', localApiStyle: 'anthropic', localBaseUrl: 'http://localhost' }, 'hello', null, 1);
      expect(result).toBe('anthropic report summary');
      global.fetch = globalFetch;
    });

    test('runAgentLoop with local lm-studio and anthropic providers', async () => {
      const mockThought = jest.fn();
      const mockContent = jest.fn();
      const mockToolCall = jest.fn();
      const globalFetch = global.fetch;
      
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Done', tool: 'none' }) } }] })
      });

      await runAgentLoop({
        provider: 'local',
        localApiStyle: 'lm-studio',
        localBaseUrl: 'http://localhost:1234',
        userMessage: 'hi',
        history: [],
        onThought: mockThought,
        onContent: mockContent,
        onToolCall: mockToolCall
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          content: [{ text: JSON.stringify({ thought: 'Done', tool: 'none' }) }],
          choices: [{ message: { content: JSON.stringify({ thought: 'Done', tool: 'none' }) } }]
        })
      });

      await runAgentLoop({
        provider: 'local',
        localApiStyle: 'anthropic',
        localBaseUrl: 'http://localhost:1234',
        userMessage: 'hi',
        history: [],
        onThought: mockThought,
        onContent: mockContent,
        onToolCall: mockToolCall
      });

      global.fetch = globalFetch;
    });

    test('runWorkerAgent routes specific actions (github create/pr, calendar create/update/delete)', async () => {
      const globalFetch = global.fetch;
      let calls = 0;
      global.fetch = jest.fn().mockImplementation((url) => {
        const urlStr = url || '';
        if (urlStr.includes('chat/completions') || urlStr.includes('completions')) {
          calls++;
          if (calls === 1) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Github actions', tool: 'github', action: 'create_issue', params: { title: 'Bug' } }) } }] })
            });
          } else if (calls === 2) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Github pr', tool: 'github', action: 'create_pr', params: { title: 'PR' } }) } }] })
            });
          } else if (calls === 3) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Calendar actions', tool: 'calendar', action: 'create', params: { title: 'Meeting' } }) } }] })
            });
          } else if (calls === 4) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Calendar update', tool: 'calendar', action: 'update', params: { id: 1 } }) } }] })
            });
          } else if (calls === 5) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Calendar delete', tool: 'calendar', action: 'delete', params: { id: 1 } }) } }] })
            });
          } else {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: 'Combined report' } }] })
            });
          }
        }
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ choices: [], results: [] })
        });
      });

      const mockDb = {
        all: jest.fn().mockResolvedValue([]),
        get: jest.fn().mockResolvedValue(null),
        run: jest.fn().mockResolvedValue({ lastID: 1, changes: 1 })
      };

      const result = await runWorkerAgent('calendar_handler', { provider: 'openai', modelName: 'gpt-4' }, 'Manage calendar actions', mockDb, 1, 'token');
      expect(result).toContain('Combined report');
      global.fetch = globalFetch;
    });

    test('runAgentTurn and runAgentResponse catch blocks on invalid URL', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'done', tool: 'none' }) } }] })
      });

      const result1 = await runAgentTurn('supervisor', 'system prompt', { provider: 'local', localBaseUrl: ':invalid_url' }, 'hello', []);
      expect(result1.thought).toBe('done');

      const result2 = await runWorkerAgent('host_specialist', { provider: 'local', localBaseUrl: ':invalid_url' }, 'hello', null, 1);
      expect(result2).toContain('done');

      global.fetch = globalFetch;
    });

    test('runWorkerAgent handles loop error', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation(() => {
        throw new Error('LLM connection failed');
      });
      await expect(
        runWorkerAgent('host_specialist', { provider: 'openai' }, 'hello', null, 1)
      ).rejects.toThrow('LLM connection failed');
      global.fetch = globalFetch;
    });

    test('runAgentLoop delegation subtask branch coverage', async () => {
      const mockThought = jest.fn();
      const mockContent = jest.fn();
      const mockToolCall = jest.fn();
      const globalFetch = global.fetch;

      const agents = ['web_searcher', 'calendar_handler', 'coder', 'qa_engineer', 'host_specialist', 'unknown_agent'];
      for (const agent of agents) {
        let calls = 0;
        global.fetch = jest.fn().mockImplementation(() => {
          calls++;
          if (calls === 1) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Delegating', tool: `delegate_to_${agent}`, params: { query: 'test', task: 'test' } }) } }] })
            });
          } else if (calls === 2) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Done', tool: 'none' }) } }] })
            });
          } else if (calls === 3) {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Done', tool: 'none' }) } }] })
            });
          } else {
            return Promise.resolve({
              ok: true,
              headers: { get: () => 'application/json' },
              json: async () => ({ choices: [{ message: { content: 'Agent complete summary' } }] })
            });
          }
        });

        await runAgentLoop({
          provider: 'openai',
          modelName: 'gpt-4',
          userMessage: 'Delegation test',
          history: [],
          onThought: mockThought,
          onContent: mockContent,
          onToolCall: mockToolCall
        });
      }

      global.fetch = globalFetch;
    });

    test('runAgentLoop delegation failure handling', async () => {
      const mockThought = jest.fn();
      const mockContent = jest.fn();
      const mockToolCall = jest.fn();
      const globalFetch = global.fetch;

      let calls = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Delegating', tool: 'delegate_to_weather_expert' }) } }] })
          });
        } else if (calls === 2) {
          throw new Error('Worker execution failed');
        } else if (calls === 3) {
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Done', tool: 'none' }) } }] })
          });
        } else {
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: 'Delegation failed summary' } }] })
          });
        }
      });

      await runAgentLoop({
        provider: 'openai',
        modelName: 'gpt-4',
        userMessage: 'Delegation fail test',
        history: [],
        onThought: mockThought,
        onContent: mockContent,
        onToolCall: mockToolCall
      });

      global.fetch = globalFetch;
    });

    test('runAgentLoop supervisor direct fallback tools', async () => {
      const mockThought = jest.fn();
      const mockContent = jest.fn();
      const mockToolCall = jest.fn();
      const globalFetch = global.fetch;

      const directTools = ['memory', 'time', 'unrecognized_tool'];
      for (const tool of directTools) {
        global.fetch = jest.fn()
          .mockResolvedValueOnce({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Calling direct tool', tool, action: 'clean_expired', params: {} }) } }] })
          })
          .mockResolvedValueOnce({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Done', tool: 'none' }) } }] })
          })
          .mockResolvedValueOnce({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: 'Direct tool complete' } }] })
          });

        const mockDb = {
          all: jest.fn().mockResolvedValue([]),
          get: jest.fn().mockResolvedValue(null),
          run: jest.fn().mockResolvedValue({ changes: 1 })
        };

        await runAgentLoop({
          db: mockDb,
          userId: 1,
          provider: 'openai',
          modelName: 'gpt-4',
          userMessage: 'Direct tool test',
          history: [],
          onThought: mockThought,
          onContent: mockContent,
          onToolCall: mockToolCall
        });
      }

      global.fetch = globalFetch;
    });

    test('runWorkerAgent routes memory tool', async () => {
      const globalFetch = global.fetch;
      let calls = 0;
      global.fetch = jest.fn().mockImplementation((url) => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Recalling memories', tool: 'memory', action: 'recall', params: { query: 'test' } }) } }] })
          });
        } else {
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Finishing', tool: 'none' }) } }] })
          });
        }
      });

      const mockDb = {
        all: jest.fn().mockResolvedValue([{ id: 1, content: 'User likes chess', level: 'long-term' }]),
        get: jest.fn().mockResolvedValue(null)
      };

      const result = await runWorkerAgent('memory_agent', { provider: 'openai', modelName: 'gpt-4' }, 'Manage memories', mockDb, 1, 'token');
      expect(result).toBeDefined();
      global.fetch = globalFetch;
    });

    test('runAgentLoop with pre-coordinator memory agent flow', async () => {
      const mockThought = jest.fn();
      const mockContent = jest.fn();
      const mockToolCall = jest.fn();
      const globalFetch = global.fetch;

      let calls = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          // Memory Agent turn 0
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Recalling', tool: 'none' }) } }] })
          });
        } else if (calls === 2) {
          // Memory Agent final response
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: 'Past memories report' } }] })
          });
        } else if (calls === 3) {
          // Supervisor turn 0
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Found memories, deciding none', tool: 'none' }) } }] })
          });
        } else {
          // Responder stream
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: 'Final supervisor response.' } }] })
          });
        }
      });

      const mockDb = {
        all: jest.fn().mockResolvedValue([]),
        get: jest.fn().mockResolvedValue(null)
      };

      await runAgentLoop({
        db: mockDb,
        userId: 1,
        provider: 'openai',
        modelName: 'gpt-4',
        userMessage: 'What are my memories?',
        history: [],
        onThought: mockThought,
        onContent: mockContent,
        onToolCall: mockToolCall,
        forceMemoryAgent: true
      });

      expect(mockContent).toHaveBeenCalledWith('Final supervisor response.');
      global.fetch = globalFetch;
    });

    test('runAgentLoop handles Memory Agent pre-run failure gracefully', async () => {
      const mockThought = jest.fn();
      const mockContent = jest.fn();
      const mockToolCall = jest.fn();
      const globalFetch = global.fetch;

      let calls = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          // Make Memory Agent turn 0 throw an error
          throw new Error('Memory LLM failed');
        } else if (calls === 2) {
          // Supervisor turn 0
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: JSON.stringify({ thought: 'Proceeding', tool: 'none' }) } }] })
          });
        } else {
          // Responder stream
          return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ choices: [{ message: { content: 'Final fallback response.' } }] })
          });
        }
      });

      const mockDb = {
        all: jest.fn().mockResolvedValue([]),
        get: jest.fn().mockResolvedValue(null)
      };

      await runAgentLoop({
        db: mockDb,
        userId: 1,
        provider: 'openai',
        modelName: 'gpt-4',
        userMessage: 'Test message',
        history: [],
        onThought: mockThought,
        onContent: mockContent,
        onToolCall: mockToolCall,
        forceMemoryAgent: true
      });

      expect(mockContent).toHaveBeenCalledWith('Final fallback response.');
      global.fetch = globalFetch;
    });
  });
});
