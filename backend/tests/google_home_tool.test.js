const { handleGoogleHomeTool } = require('../tools/google_home_tool');

jest.mock('../utils/tts', () => ({
  generateTTS: jest.fn(() => Promise.resolve('/tts/mocked_hash.mp3'))
}));

jest.mock('chromecast-api', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn()
    };
  });
});

jest.mock('chromecast-api/lib/device', () => {
  return jest.fn().mockImplementation(() => {
    return {
      play: jest.fn((url, options, callback) => callback(null)),
      on: jest.fn()
    };
  });
});

jest.mock('google-assistant', () => {
  return jest.fn().mockImplementation(() => {
    const assistant = {
      on: jest.fn((event, callback) => {
        if (event === 'ready') {
          setTimeout(callback, 0);
        }
        return assistant;
      }),
      start: jest.fn((conversationConfig, callback) => {
        const conversation = {
          on: jest.fn().mockImplementation(function(event, cb) {
            if (event === 'error') {
              setTimeout(() => cb(new Error('Mocked SDK failure')), 0);
            }
            return this;
          })
        };
        setTimeout(() => callback(conversation), 0);
      })
    };
    return assistant;
  });
});

describe('Google Home Tool Tests', () => {
  let dbMock;

  beforeEach(() => {
    dbMock = {
      get: jest.fn(() => Promise.resolve({
        google_home_ip: '192.168.1.199',
        google_home_name: null
      })),
      run: jest.fn(() => Promise.resolve())
    };
  });

  test('returns error for invalid action', async () => {
    const res = await handleGoogleHomeTool(dbMock, 1, 'invalid_action', {});
    expect(JSON.parse(res).error).toContain('Unknown action');
  });

  test('returns error when command parameter is missing', async () => {
    const res = await handleGoogleHomeTool(dbMock, 1, 'send_command', {});
    expect(JSON.parse(res).error).toContain('Command string is required');
  });

  test('successfully sends command and prepends Ok Google', async () => {
    const res = await handleGoogleHomeTool(dbMock, 1, 'send_command', { command: 'turn off lights' });
    const parsed = JSON.parse(res);
    expect(parsed.success).toBe(true);
    expect(parsed.command_sent).toBe('Ok Google, turn off lights');
  });
});
