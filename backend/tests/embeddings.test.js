const { getEmbedding, cosineSimilarity, getKeywordSimilarity, getSemanticSimilarity } = require('../utils/embeddings');

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
  });

  afterEach(() => {
    delete global.fetch;
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
});
