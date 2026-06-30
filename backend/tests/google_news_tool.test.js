const { handleGoogleNewsTool } = require('../tools/google_news_tool');

// Mock decoder dependency
jest.mock('google-news-url-decoder', () => ({
  GoogleDecoder: jest.fn().mockImplementation(() => ({
    decode: jest.fn().mockResolvedValue({ status: true, decoded_url: 'https://decoded-news.com/article' })
  }))
}));

global.fetch = jest.fn();

describe('Google News Tool Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('scrapes RSS headlines and processes article content', async () => {
    // Mock 1: RSS feed response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <rss><channel>
          <item>
            <title>Breaking tech update</title>
            <link>https://news.google.com/rss/articles/123</link>
          </item>
        </channel></rss>
      `
    });

    // Mock 2: Article page fetch response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html>
          <body>
            <p>Major news update: tech development continues at rapid pace.</p>
          </body>
        </html>
      `
    });

    const result = await handleGoogleNewsTool('tech');
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty('source', 'Google News (Search: "tech")');
    expect(parsed.articles.length).toBe(1);
    expect(parsed.articles[0].headline).toBe('Breaking tech update');
    expect(parsed.articles[0].link).toBe('https://decoded-news.com/article');
    expect(parsed.articles[0].content).toContain('Major news update');
  });

  test('returns error on RSS fetch failure', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false });

    const result = await handleGoogleNewsTool();
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty('error');
  });
});
