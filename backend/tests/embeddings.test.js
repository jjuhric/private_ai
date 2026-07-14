// Mock @xenova/transformers
jest.mock('@xenova/transformers', () => {
  const mockExtractor = jest.fn().mockResolvedValue({
    data: [0.1, 0.2, 0.3]
  });
  return {
    pipeline: jest.fn().mockResolvedValue(mockExtractor)
  };
});

// Mock @lancedb/lancedb
const mockAdd = jest.fn();
const mockDelete = jest.fn();
const mockExecute = jest.fn().mockResolvedValue([
  {
    text: 'test memory text',
    metadata: JSON.stringify({ userId: 1, level: 'long-term' }),
    _distance: 0.1
  }
]);

const mockSearch = jest.fn().mockReturnValue({
  metricType: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  execute: mockExecute
});

const mockTable = {
  add: mockAdd,
  delete: mockDelete,
  search: mockSearch
};

const mockDb = {
  tableNames: jest.fn().mockResolvedValue(['memory']),
  openTable: jest.fn().mockResolvedValue(mockTable),
  createTable: jest.fn().mockResolvedValue(mockTable)
};

jest.mock('@lancedb/lancedb', () => {
  return {
    connect: jest.fn().mockResolvedValue(mockDb)
  };
});

const { getEmbedding, cosineSimilarity, getKeywordSimilarity, getSemanticSimilarity, storeMemory, searchMemory } = require('../utils/embeddings');

// Mock @google/generative-ai
jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => {
      return {
        getGenerativeModel: jest.fn().mockImplementation((config) => {
          return {
            embedContent: jest.fn().mockImplementation(async (text) => {
              if (text === 'fail-gemini') {
                throw new Error('Gemini error');
              }
              return {
                embedding: {
                  values: [0.1, 0.2, 0.3]
                }
              };
            })
          };
        })
      };
    })
  };
});

describe('Embeddings Utility Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    global.__mockTable = mockTable;
  });

  afterEach(() => {
    delete global.fetch;
    delete global.__mockTable;
  });

  describe('getEmbedding', () => {
    test('Gemini provider success', async () => {
      const userSettings = {
        provider: 'gemini',
        online_key: 'test-key'
      };
      const result = await getEmbedding('hello', userSettings);
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    test('Gemini fallback key check', async () => {
      const userSettings = {
        gemini_key: 'fallback-key'
      };
      const result = await getEmbedding('hello', userSettings);
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    test('Gemini missing key returns null', async () => {
      const userSettings = {
        provider: 'gemini'
      };
      const result = await getEmbedding('hello', userSettings);
      expect(result).toBeNull();
    });

    test('Gemini error handler returns null', async () => {
      const userSettings = {
        provider: 'gemini',
        online_key: 'test-key'
      };
      const result = await getEmbedding('fail-gemini', userSettings);
      expect(result).toBeNull();
    });

    test('Local provider success (fetch /embeddings)', async () => {
      const userSettings = {
        provider: 'local',
        local_url: 'http://localhost:1234/v1',
        local_key: 'local-key',
        model_name: 'nomic-embed'
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.4, 0.5, 0.6] }]
        })
      });

      const result = await getEmbedding('hello', userSettings);
      expect(result).toEqual([0.4, 0.5, 0.6]);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:1234/v1/embeddings', expect.any(Object));
    });

    test('Local provider fetch failure returns null', async () => {
      const userSettings = {
        provider: 'local',
        local_url: 'http://localhost:1234/v1'
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: false
      });

      const result = await getEmbedding('hello', userSettings);
      expect(result).toBeNull();
    });

    test('Online custom provider success', async () => {
      const userSettings = {
        provider: 'online',
        online_provider: 'custom',
        online_url: 'http://custom-api.com/v1',
        online_key: 'online-key'
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.7, 0.8, 0.9] }]
        })
      });

      const result = await getEmbedding('hello', userSettings);
      expect(result).toEqual([0.7, 0.8, 0.9]);
    });

    test('Local provider exception handler returns null', async () => {
      const userSettings = {
        provider: 'local',
        local_url: 'http://localhost:1234/v1'
      };

      global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

      const result = await getEmbedding('hello', userSettings);
      expect(result).toBeNull();
    });

    test('No baseUrl configured returns null', async () => {
      const userSettings = {
        provider: 'local'
      };
      const result = await getEmbedding('hello', userSettings);
      expect(result).toBeNull();
    });
  });

  describe('cosineSimilarity', () => {
    test('invalid inputs return 0', () => {
      expect(cosineSimilarity(null, null)).toBe(0);
      expect(cosineSimilarity([1], [1, 2])).toBe(0);
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });

    test('identical vectors return 1.0', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
    });

    test('orthogonal vectors return 0', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    });
  });

  describe('getSemanticSimilarity', () => {
    test('falls back to keyword similarity if one vector is missing or empty', () => {
      expect(getSemanticSimilarity('Hiking is fun', null, 'Hiking is fun', [0.1])).toBe(1.0);
      expect(getSemanticSimilarity('Hiking is fun', [0.1], 'Hiking is fun', [])).toBe(1.0);
    });

    test('uses cosine similarity if both vectors are valid', () => {
      expect(getSemanticSimilarity('Hiking', [1, 0], 'Hiking', [1, 0])).toBeCloseTo(1.0);
      expect(getSemanticSimilarity('Hiking', [1, 0], 'Hiking', [0, 1])).toBe(0);
    });
  });

  describe('storeMemory', () => {
    test('should vectorize text and store it in LanceDB memory table', async () => {
      await storeMemory('test store memory content', { userId: 1, level: 'long-term' });
      expect(mockAdd).toHaveBeenCalledWith([
        expect.objectContaining({
          vector: [0.1, 0.2, 0.3],
          text: 'test store memory content',
          metadata: JSON.stringify({ userId: 1, level: 'long-term' })
        })
      ]);
    });
  });

  describe('searchMemory', () => {
    test('should query LanceDB memory table and return minified JSON array of results', async () => {
      const resultsStr = await searchMemory('test query text', 3);
      const results = JSON.parse(resultsStr);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          text: 'test memory text',
          metadata: expect.objectContaining({ userId: 1, level: 'long-term' }),
          score: expect.any(Number)
        })
      );
      expect(mockSearch).toHaveBeenCalledWith([0.1, 0.2, 0.3]);
    });
  });
});
