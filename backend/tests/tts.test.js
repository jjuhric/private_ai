const { cleanTextForSpeech, chunkText } = require('../utils/tts');
const { handleTtsTool } = require('../tools/tts_tool');

describe('TTS Utility & Tool Tests', () => {
  test('cleanTextForSpeech strips markdown and emojis', () => {
    const raw = 'Hello **world**! Check [Google](https://google.com) and `code`. 😊✨';
    const cleaned = cleanTextForSpeech(raw);
    expect(cleaned).toBe('Hello world! Check Google and code.');
  });

  test('chunkText splits text preserving word boundaries', () => {
    const text = 'This is a long sentence that should be split into multiple smaller chunks of text.';
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(chunk => {
      expect(chunk.length).toBeLessThanOrEqual(20);
    });
  });

  test('handleTtsTool actions', async () => {
    // Test action check
    const badAction = await handleTtsTool(null, null, 'invalid', {});
    expect(badAction).toContain('Error: Unknown action');

    // Test text validation
    const missingText = await handleTtsTool(null, null, 'speak', {});
    expect(missingText).toContain('Error: "text" parameter is required');
  });
});
