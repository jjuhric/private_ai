const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Retrieves a vector embedding for a given text.
 * Supports Gemini API (text-embedding-004) and local/OpenAI-style endpoints (/embeddings).
 * 
 * @param {string} text The text to embed.
 * @param {object} userSettings The user's settings containing API keys.
 * @returns {Promise<number[]|null>} Array of floats representing embedding or null.
 */
async function getEmbedding(text, userSettings = {}) {
  const isGemini = userSettings.provider === 'gemini' || 
                   (userSettings.provider === 'online' && userSettings.online_provider === 'gemini') ||
                   (!userSettings.provider && (userSettings.online_key || userSettings.gemini_key));

  if (isGemini) {
    const apiKey = userSettings.online_key || userSettings.gemini_key;
    if (!apiKey) {
      console.warn('Embeddings: No Gemini API Key configured in user settings.');
      return null;
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const result = await model.embedContent(text);
      if (result && result.embedding && result.embedding.values) {
        return result.embedding.values;
      }
    } catch (err) {
      console.error('Embeddings: Failed to generate embedding via Gemini API:', err.message);
    }
  } else {
    // Local / OpenAI / Custom provider
    let baseUrl = '';
    let apiKey = '';
    let modelName = 'text-embedding-ada-002';

    if (userSettings.provider === 'local') {
      baseUrl = userSettings.local_url || 'http://192.168.1.42:1234/v1';
      apiKey = userSettings.local_key || '';
      modelName = userSettings.model_name || 'text-embedding-ada-002';
    } else {
      baseUrl = userSettings.online_url || '';
      apiKey = userSettings.online_key || '';
      modelName = userSettings.model_name || 'text-embedding-ada-002';
    }

    if (baseUrl) {
      try {
        let endpoint = baseUrl.replace(/\/$/, '');
        if (!endpoint.endsWith('/embeddings')) {
          endpoint = `${endpoint}/embeddings`;
        }

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey && apiKey !== 'lm-studio') {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: text,
            model: modelName
          })
        });

        if (response.ok) {
          const data = await response.json();
          const embedding = data.data?.[0]?.embedding;
          if (embedding && Array.isArray(embedding)) {
            return embedding;
          }
        }
      } catch (err) {
        console.error('Embeddings: Failed to generate embedding via Local/OpenAI endpoint:', err.message);
      }
    }
  }

  return null;
}

/**
 * Computes cosine similarity between two vectors.
 * 
 * @param {number[]} vecA First vector.
 * @param {number[]} vecB Second vector.
 * @returns {number} Cosine similarity score between -1 and 1.
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Computes a Jaccard token similarity score as a robust fallback.
 * 
 * @param {string} str1 First string.
 * @param {string} str2 Second string.
 * @returns {number} Jaccard similarity score between 0 and 1.
 */
function getKeywordSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) {
    return 1.0;
  }
  const words1 = new Set(s1.match(/\w+/g) || []);
  const words2 = new Set(s2.match(/\w+/g) || []);
  if (words1.size === 0 || words2.size === 0) return 0;
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  const jaccard = intersection.size / union.size;

  if (s1.includes(s2) || s2.includes(s1)) {
    return Math.max(jaccard, 0.5);
  }
  return jaccard;
}

/**
 * Computes semantic similarity, falling back to keyword similarity if vectors are not available.
 * 
 * @param {string} textA First text.
 * @param {number[]|null} vecA First embedding.
 * @param {string} textB Second text.
 * @param {number[]|null} vecB Second embedding.
 * @returns {number} Semantic similarity score.
 */
function getSemanticSimilarity(textA, vecA, textB, vecB) {
  if (vecA && vecB && Array.isArray(vecA) && Array.isArray(vecB) && vecA.length > 0 && vecB.length > 0) {
    return cosineSimilarity(vecA, vecB);
  }
  return getKeywordSimilarity(textA, textB);
}

module.exports = {
  getEmbedding,
  cosineSimilarity,
  getKeywordSimilarity,
  getSemanticSimilarity
};
