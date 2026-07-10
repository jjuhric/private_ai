const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

/**
 * Strips markdown symbols, code blocks, HTML tags, and emojis from the text
 * to make the speech output clean and natural.
 */
function cleanTextForSpeech(text) {
  if (!text) return '';
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove markdown links but keep text: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove formatting marks (asterisks, backticks, tildes, hashes, dashes) while keeping text
    .replace(/[*_#~`-]/g, '')
    // Remove emojis and symbols including sparkles
    .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]|[\u2700-\u27BF]/g, '')
    // Replace multiple spaces or newlines with a single space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits text into chunks of maximum length maxLen, preserving word boundaries.
 */
function chunkText(text, maxLen = 150) {
  const words = text.split(' ');
  const chunks = [];
  let currentChunk = '';

  for (const word of words) {
    if ((currentChunk + ' ' + word).trim().length > maxLen) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = word;
    } else {
      currentChunk = (currentChunk + ' ' + word).trim();
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

/**
 * Downloads a single text chunk audio buffer from Google Translate TTS.
 */
async function downloadChunk(chunk) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(chunk)}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Google TTS status: ${res.statusCode}`));
        return;
      }
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Generates an MP3 file from the given text and returns its public URL.
 * Caches files by hashing the cleaned text.
 */
async function generateTTS(text) {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) {
    throw new Error('TTS: No speakable content found after cleaning.');
  }

  // Hash the cleaned text to get a unique cache filename
  const hash = crypto.createHash('md5').update(cleaned).digest('hex');
  const filename = `${hash}.mp3`;
  const ttsDir = path.join(__dirname, '../public/tts');
  const filePath = path.join(ttsDir, filename);

  // If cached file exists, return the cached public path
  if (fs.existsSync(filePath)) {
    return `/tts/${filename}`;
  }

  // Ensure directories exist
  if (!fs.existsSync(ttsDir)) {
    fs.mkdirSync(ttsDir, { recursive: true });
  }

  // Chunk text and download chunks
  const chunks = chunkText(cleaned, 150);
  const buffers = [];

  for (const chunk of chunks) {
    const buf = await downloadChunk(chunk);
    buffers.push(buf);
  }

  // Concat all buffers and write file
  const finalBuffer = Buffer.concat(buffers);
  fs.writeFileSync(filePath, finalBuffer);

  return `/tts/${filename}`;
}

module.exports = {
  cleanTextForSpeech,
  chunkText,
  generateTTS
};
