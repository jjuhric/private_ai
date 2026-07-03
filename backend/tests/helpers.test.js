jest.mock('cheerio', () => {
  const actualCheerio = jest.requireActual('cheerio');
  return {
    ...actualCheerio,
    load: (html) => {
      if (html && html.includes('trigger-error')) {
        throw new Error('Forced cheerio error');
      }
      return actualCheerio.load(html);
    }
  };
});

const { extractFirst100Words } = require('../utils/helpers');

describe('Helpers Utility Tests', () => {
  test('extractFirst100Words should extract text from HTML using Cheerio', () => {
    const html = '<html><body><h1>Hello World</h1><p>This is a paragraph. Script should be removed.</p><script>console.log("no")</script></body></html>';
    const text = extractFirst100Words(html);
    expect(text).toContain('Hello World');
    expect(text).toContain('This is a paragraph.');
    expect(text).not.toContain('console.log');
  });

  test('extractFirst100Words should return empty string if no HTML provided', () => {
    expect(extractFirst100Words(null)).toBe('');
    expect(extractFirst100Words('')).toBe('');
  });

  test('extractFirst100Words should truncate text to 100 words and append ellipsis', () => {
    const words = Array(150).fill('word').join(' ');
    const html = `<html><body>${words}</body></html>`;
    const text = extractFirst100Words(html);
    const count = text.split(/\s+/).length;
    expect(count).toBe(100); // 100 words (with trailing ellipsis attached to the last word)
    expect(text.endsWith('...')).toBe(true);
  });

  test('extractFirst100Words should fall back to regex parsing if cheerio load throws', () => {
    const html = '<html><head><title>Test</title></head><body><h1>Hello Regex Fallback trigger-error</h1></body></html>';
    const text = extractFirst100Words(html);
    expect(text).toContain('Hello Regex Fallback');
    expect(text).not.toContain('Test');
  });
});
