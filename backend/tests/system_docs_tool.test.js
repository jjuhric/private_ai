jest.mock('../utils/embeddings', () => ({
  searchSystemDocs: jest.fn()
}));

const { searchSystemDocs } = require('../utils/embeddings');
const { handleSystemDocsTool } = require('../tools/system_docs_tool');

describe('System Docs Tool Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('unknown action returns error message', async () => {
    const res = await handleSystemDocsTool('unknown_action', { query: 'test' });
    expect(res).toContain('Error: Unknown System Docs action');
  });

  test('missing query returns error message', async () => {
    const res = await handleSystemDocsTool('query', {});
    expect(res).toContain('Error: "query" parameter is required');
  });

  test('returns formatted report citing source for matches above threshold', async () => {
    searchSystemDocs.mockResolvedValue([
      { text: 'Write a manifest.json, handler.js, and handler.test.js.', metadata: { source: 'Contributing.md' }, score: 0.72 },
      { text: 'Irrelevant low-score chunk.', metadata: { source: 'FAQ.md' }, score: 0.1 }
    ]);

    const res = await handleSystemDocsTool('query', { query: 'how do I add a new tool' });

    expect(searchSystemDocs).toHaveBeenCalledWith('how do I add a new tool', 5);
    expect(res).toContain('PATTI Documentation Retrieval Results');
    expect(res).toContain('Contributing.md');
    expect(res).toContain('manifest.json, handler.js, and handler.test.js');
    expect(res).not.toContain('Irrelevant low-score chunk');
  });

  test('returns no-match message when nothing clears the similarity threshold', async () => {
    searchSystemDocs.mockResolvedValue([
      { text: 'Irrelevant chunk.', metadata: { source: 'FAQ.md' }, score: 0.05 }
    ]);

    const res = await handleSystemDocsTool('query', { query: 'something unrelated' });
    expect(res).toContain('No relevant sections');
  });

  test('handles search errors gracefully', async () => {
    searchSystemDocs.mockRejectedValue(new Error('LanceDB unavailable'));

    const res = await handleSystemDocsTool('query', { query: 'test' });
    expect(res).toContain('Error searching PATTI\'s documentation');
    expect(res).toContain('LanceDB unavailable');
  });
});
