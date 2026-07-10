const { generateTTS } = require('../utils/tts');

async function handleTtsTool(db, userId, action, params) {
  if (action === 'speak') {
    const text = params?.text;
    if (!text) {
      return 'Error: "text" parameter is required.';
    }

    try {
      const audioUrl = await generateTTS(text);
      return `Success: Speech generated successfully.\nAudio URL: ${audioUrl}`;
    } catch (err) {
      return `Error: Failed to generate TTS speech: ${err.message}`;
    }
  }

  return `Error: Unknown action "${action}" for tts tool.`;
}

module.exports = { handleTtsTool };
