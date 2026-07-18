// Regression test: some environments (e.g. incompatible protobufjs versions
// pulled in by google-assistant's own nested dependency) make
// require('google-assistant') throw synchronously. That must degrade
// gracefully to the plain-TTS fallback instead of crashing the tool call.

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => true)
}));

jest.mock('google-assistant', () => {
  throw new Error("ENOENT: no such file or directory, open 'node_modules/google-assistant/lib/google/protobuf/descriptor.proto'");
});

jest.mock('../utils/tts', () => ({
  generateTTS: jest.fn(() => Promise.resolve('/tts/mocked_hash.mp3'))
}));

jest.mock('chromecast-api', () => {
  return jest.fn().mockImplementation(() => ({ on: jest.fn() }));
});

jest.mock('chromecast-api/lib/device', () => {
  return jest.fn().mockImplementation(() => ({
    play: jest.fn((url, options, callback) => callback(null)),
    on: jest.fn()
  }));
});

const { handleGoogleHomeTool } = require('../tools/google_home_tool');

describe('Google Home Tool - google-assistant load failure', () => {
  test('send_command falls back to plain TTS instead of throwing when google-assistant fails to load', async () => {
    const dbMock = {
      get: jest.fn(() => Promise.resolve({
        google_home_enabled: 1,
        google_home_ip: '192.168.1.60',
        google_home_name: null
      })),
      run: jest.fn(() => Promise.resolve())
    };

    const res = await handleGoogleHomeTool(dbMock, 1, 'send_command', { command: 'turn off office lights' });
    const parsed = JSON.parse(res);

    expect(parsed.success).toBe(true);
    expect(parsed.command_sent).toBe('Ok Google, turn off office lights');
    expect(parsed.assistant_response).toBeNull();
  });
});
