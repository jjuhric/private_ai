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
  const { decrypt } = require('./crypto');
  const decryptedSettings = {
    ...userSettings,
    online_key: decrypt(userSettings.online_key),
    gemini_key: decrypt(userSettings.gemini_key),
    local_key: decrypt(userSettings.local_key)
  };

  const isGemini = decryptedSettings.provider === 'gemini' || 
                   (decryptedSettings.provider === 'online' && decryptedSettings.online_provider === 'gemini') ||
                   (!decryptedSettings.provider && (decryptedSettings.online_key || decryptedSettings.gemini_key));

  if (isGemini) {
    const apiKey = decryptedSettings.online_key || decryptedSettings.gemini_key;
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

    if (decryptedSettings.provider === 'local') {
      baseUrl = decryptedSettings.local_url || 'http://192.168.1.42:1234/v1';
      apiKey = decryptedSettings.local_key || '';
      modelName = 'text-embedding-ada-002';

      try {
        let modelsUrl = baseUrl.trim();
        if (!modelsUrl.startsWith('http://') && !modelsUrl.startsWith('https://')) {
          modelsUrl = `http://${modelsUrl}`;
        }
        modelsUrl = modelsUrl.replace(/\/$/, '');
        modelsUrl = `${modelsUrl}/models`;

        const headers = {};
        if (apiKey && apiKey !== 'lm-studio') {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        const modelsRes = await fetch(modelsUrl, { headers });
        if (modelsRes && modelsRes.ok) {
          const modelsData = await modelsRes.json();
          const modelsList = modelsData.data || [];
          const foundEmbedModel = modelsList.find(m => 
            m.id && (m.id.toLowerCase().includes('embed') || m.id.toLowerCase().includes('nomic'))
          );
          if (foundEmbedModel) {
            modelName = foundEmbedModel.id;
          }
        }
      } catch (err) {
        console.warn('Embeddings: Failed to auto-detect local embedding model:', err.message);
      }
    } else {
      baseUrl = decryptedSettings.online_url || '';
      apiKey = decryptedSettings.online_key || '';
      modelName = decryptedSettings.model_name || 'text-embedding-ada-002';
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

        if (response && response.ok) {
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

const path = require('path');
const fs = require('fs');

let transformersPipeline = null;
async function getXenovaExtractor() {
  if (process.env.NODE_ENV === 'test') {
    return async () => ({
      data: [0.1, 0.2, 0.3]
    });
  }
  if (!transformersPipeline) {
    const { pipeline } = require('@xenova/transformers');
    transformersPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return transformersPipeline;
}

let lancedbConnection = null;
const vectorStorePath = path.resolve(__dirname, '../../data/vector-store');

async function getLanceDb() {
  if (process.env.NODE_ENV === 'test') {
    return {
      tableNames: async () => ['memory'],
      openTable: async () => ({
        add: async () => {},
        delete: async () => {},
        search: () => ({
          metricType: () => ({
            limit: () => ({
              execute: async () => [
                {
                  text: 'test memory text',
                  metadata: JSON.stringify({ userId: 1, level: 'long-term' }),
                  _distance: 0.1
                }
              ]
            })
          })
        })
      })
    };
  }
  if (!lancedbConnection) {
    const lance = require('vectordb');
    if (!fs.existsSync(vectorStorePath)) {
      fs.mkdirSync(vectorStorePath, { recursive: true });
    }
    lancedbConnection = await lance.connect(vectorStorePath);
  }
  return lancedbConnection;
}

async function getMemoryTable() {
  if (process.env.NODE_ENV === 'test' && global.__mockTable) {
    return global.__mockTable;
  }
  const db = await getLanceDb();
  if (process.env.NODE_ENV === 'test') {
    return await db.openTable('memory');
  }
  const tableNames = await db.tableNames();
  if (tableNames.includes('memory')) {
    return await db.openTable('memory');
  } else {
    // 384 dimensions for all-MiniLM-L6-v2
    const dummyVector = new Array(384).fill(0);
    const table = await db.createTable('memory', [
      {
        vector: dummyVector,
        text: 'dummy_init',
        metadata: JSON.stringify({ init: true })
      }
    ]);
    await table.delete('text = "dummy_init"');
    return table;
  }
}

async function getXenovaEmbedding(text) {
  const extractor = await getXenovaExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function storeMemory(text, metadata = {}) {
  try {
    const vector = await getXenovaEmbedding(text);
    const table = await getMemoryTable();
    await table.add([
      {
        vector,
        text,
        metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata)
      }
    ]);
  } catch (err) {
    console.error('storeMemory error:', err);
    throw err;
  }
}

async function searchMemory(query, limit = 3) {
  try {
    const vector = await getXenovaEmbedding(query);
    const table = await getMemoryTable();
    const results = await table
      .search(vector)
      .metricType('cosine')
      .limit(limit)
      .execute();

    const minified = results.map(r => ({
      text: r.text,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      score: 1 - r._distance
    }));
    return JSON.stringify(minified);
  } catch (err) {
    console.error('searchMemory error:', err);
    return JSON.stringify([]);
  }
}

async function getLearnedBehaviorsTable() {
  if (process.env.NODE_ENV === 'test' && global.__mockLearnedTable) {
    return global.__mockLearnedTable;
  }
  const db = await getLanceDb();
  if (process.env.NODE_ENV === 'test') {
    return await db.openTable('learned_behaviors');
  }
  const tableNames = await db.tableNames();
  if (tableNames.includes('learned_behaviors')) {
    return await db.openTable('learned_behaviors');
  } else {
    const dummyVector = new Array(384).fill(0);
    const table = await db.createTable('learned_behaviors', [
      {
        vector: dummyVector,
        text: 'dummy_init',
        metadata: JSON.stringify({ init: true })
      }
    ]);
    await table.delete('text = "dummy_init"');
    return table;
  }
}

async function storeLearnedBehavior(text, metadata = {}) {
  try {
    const vector = await getXenovaEmbedding(text);
    const table = await getLearnedBehaviorsTable();
    await table.add([
      {
        vector,
        text,
        metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata)
      }
    ]);
  } catch (err) {
    console.error('storeLearnedBehavior error:', err);
    throw err;
  }
}

async function searchLearnedBehaviors(query, limit = 3) {
  try {
    const vector = await getXenovaEmbedding(query);
    const table = await getLearnedBehaviorsTable();
    const results = await table
      .search(vector)
      .metricType('cosine')
      .limit(limit)
      .execute();

    return results.map(r => ({
      text: r.text,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      score: 1 - r._distance
    }));
  } catch (err) {
    console.error('searchLearnedBehaviors error:', err);
    return [];
  }
}

module.exports = {
  getEmbedding,
  cosineSimilarity,
  getKeywordSimilarity,
  getSemanticSimilarity,
  storeMemory,
  searchMemory,
  storeLearnedBehavior,
  searchLearnedBehaviors
};
