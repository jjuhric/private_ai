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
// Note: the real installed @lancedb/lancedb table API is `.vectorSearch(vec).distanceType('cosine').limit(n).toArray()`,
// not the older `.search(vec).metricType('cosine').limit(n).execute()` shape - mocks below match the real API.
const mockAdd = jest.fn();
const mockDelete = jest.fn();
const mockToArray = jest.fn().mockResolvedValue([
  {
    text: 'test memory text',
    metadata: JSON.stringify({ userId: 1, level: 'long-term' }),
    _distance: 0.1
  }
]);

const mockSearch = jest.fn().mockReturnValue({
  distanceType: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: mockToArray
});

const mockTable = {
  add: mockAdd,
  delete: mockDelete,
  vectorSearch: mockSearch
};

const mockSystemDocsAdd = jest.fn();
const mockSystemDocsToArray = jest.fn().mockResolvedValue([
  {
    text: 'Write a manifest.json, handler.js, and handler.test.js for the new tool.',
    metadata: JSON.stringify({ source: 'Contributing.md' }),
    _distance: 0.2
  }
]);
const mockSystemDocsSearch = jest.fn().mockReturnValue({
  distanceType: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: mockSystemDocsToArray
});
const mockSystemDocsTable = {
  add: mockSystemDocsAdd,
  delete: jest.fn(),
  vectorSearch: mockSystemDocsSearch
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

const { getEmbedding, cosineSimilarity, getKeywordSimilarity, getSemanticSimilarity, storeMemory, searchMemory, storeSystemDoc, searchSystemDocs } = require('../utils/embeddings');

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
    global.__mockSystemDocsTable = mockSystemDocsTable;
  });

  afterEach(() => {
    delete global.fetch;
    delete global.__mockTable;
    delete global.__mockSystemDocsTable;
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

  describe('storeSystemDoc', () => {
    test('should vectorize text and store it in the LanceDB system_docs table', async () => {
      await storeSystemDoc('Write a manifest.json for the new tool.', { source: 'Contributing.md' });
      expect(mockSystemDocsAdd).toHaveBeenCalledWith([
        expect.objectContaining({
          vector: [0.1, 0.2, 0.3],
          text: 'Write a manifest.json for the new tool.',
          metadata: JSON.stringify({ source: 'Contributing.md' })
        })
      ]);
      // Confirms system_docs and memory tables stay isolated from one another
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });

  describe('searchSystemDocs', () => {
    test('should query the LanceDB system_docs table and return scored results', async () => {
      const results = await searchSystemDocs('how do I add a new tool', 5);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          text: 'Write a manifest.json, handler.js, and handler.test.js for the new tool.',
          metadata: expect.objectContaining({ source: 'Contributing.md' }),
          score: expect.any(Number)
        })
      );
      expect(mockSystemDocsSearch).toHaveBeenCalledWith([0.1, 0.2, 0.3]);
      // Confirms system_docs and memory tables stay isolated from one another
      expect(mockSearch).not.toHaveBeenCalled();
    });

    test('should return an empty array if the search throws', async () => {
      mockSystemDocsSearch.mockReturnValueOnce({
        distanceType: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockRejectedValue(new Error('LanceDB unavailable'))
      });
      const results = await searchSystemDocs('test query');
      expect(results).toEqual([]);
    });
  });
});
