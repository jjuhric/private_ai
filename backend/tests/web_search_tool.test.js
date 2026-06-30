const { handleWebSearchTool } = require('../tools/web_search_tool');
const cheerio = require('cheerio');

global.fetch = jest.fn();

describe('Web Search Tool Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Direct URL Scraping - extracts clean body content', async () => {
    // Mock the direct URL fetch response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html>
          <head>
            <title>Cowboys Schedule</title>
            <style>body { background: #000; }</style>
          </head>
          <body>
            <nav>Home About</nav>
            <main>
              <h1>Dallas Cowboys Schedule 2026</h1>
              <p>Week 1 vs Giants - Sept 13</p>
            </main>
            <footer>Contact Us</footer>
          </body>
        </html>
      `
    });

    const result = await handleWebSearchTool(null, null, 'https://www.dallascowboys.com/schedule/');
    expect(result).toContain('Direct Page Scrape: [Cowboys Schedule]');
    expect(result).toContain('Dallas Cowboys Schedule 2026');
    expect(result).toContain('Week 1 vs Giants');
    // Verify script, nav, style, and footer tags were stripped
    expect(result).not.toContain('Contact Us');
    expect(result).not.toContain('Home About');
  });

  test('DuckDuckGo Search Scraper - parses links and redirects successfully', async () => {
    // Mock 1: DDG search results page HTML
    global.fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <div class="result__body">
          <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnyc.com%2Fnews&amp;rut=1">Latest NYC News</a>
          <h2 class="result__title">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnyc.com%2Fnews&amp;rut=1">NYC News Hub</a>
          </h2>
          <div class="result__snippet">The latest breaking local news in New York City.</div>
        </div>
      `
    });

    // Mock 2: Scrape page content fetch
    global.fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html>
          <body>
            <p>New York City breaking news update page content</p>
          </body>
        </html>
      `
    });

    const result = await handleWebSearchTool(null, null, 'NYC breaking news');
    expect(result).toContain('## 🔍 Deep Web Search Report for: *"NYC breaking news"*');
    expect(result).toContain('[NYC News Hub](https://nyc.com/news)');
    expect(result).toContain('New York City breaking news update page content');
  });

  test('Wikipedia API Fallback - executes on DuckDuckGo and Google failover', async () => {
    // Mock 1: DuckDuckGo search fails
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    // Mock 2: Google fallback search fails
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    // Mock 3: Wikipedia API search succeeds
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          search: [
            {
              title: 'Vite (software)',
              snippet: 'Vite is a local development server written by Evan You.',
              pageid: 12345
            }
          ]
        }
      })
    });

    const result = await handleWebSearchTool(null, null, 'Vite software');
    expect(result).toContain('Vite (software)');
    expect(result).toContain('Vite is a local development server written by Evan You.');
  });
});
