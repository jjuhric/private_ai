jest.mock('../tools/web_search_tool', () => ({
  handleWebSearchTool: jest.fn()
}));

jest.mock('../tools/google_news_tool', () => ({
  handleGoogleNewsTool: jest.fn()
}));

const { handleWebSearchTool } = require('../tools/web_search_tool');
const { handleGoogleNewsTool } = require('../tools/google_news_tool');
const { handleSportsTool } = require('../tools/sports_tool');

function makeMockDb({ favoriteTeams = ['Dallas Cowboys', 'Texas Rangers'] } = {}) {
  return {
    get: jest.fn().mockResolvedValue({ favorite_teams: JSON.stringify(favoriteTeams) }),
    all: jest.fn().mockResolvedValue([]),
    run: jest.fn().mockResolvedValue({})
  };
}

describe('Sports Tool Tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('unknown action returns error', async () => {
    const res = await handleSportsTool(makeMockDb(), 1, 'do_something_else', {});
    expect(res).toContain('Unknown action');
  });

  describe('get_favorite_teams', () => {
    test('lists stored favorite teams', async () => {
      const res = await handleSportsTool(makeMockDb(), 1, 'get_favorite_teams', {});
      expect(res).toContain('Dallas Cowboys');
      expect(res).toContain('Texas Rangers');
    });

    test('suggests adding favorites when none are saved', async () => {
      const res = await handleSportsTool(makeMockDb({ favoriteTeams: [] }), 1, 'get_favorite_teams', {});
      expect(res).toContain('no favorite teams saved');
    });

    test('handles malformed favorite_teams JSON gracefully', async () => {
      const db = makeMockDb();
      db.get.mockResolvedValue({ favorite_teams: 'not-json{{' });
      const res = await handleSportsTool(db, 1, 'get_favorite_teams', {});
      expect(res).toContain('no favorite teams saved');
    });
  });

  describe('get_schedule', () => {
    test('uses the explicit team when provided and avoids the word "news" in the query', async () => {
      handleWebSearchTool.mockResolvedValue('Cowboys play Eagles on Sunday 3:25 PM');
      const res = await handleSportsTool(makeMockDb(), 1, 'get_schedule', { team: 'Dallas Cowboys' });

      expect(handleWebSearchTool).toHaveBeenCalledTimes(1);
      const query = handleWebSearchTool.mock.calls[0][2];
      expect(query).toContain('Dallas Cowboys');
      expect(query.toLowerCase()).not.toContain('news');
      expect(res).toContain('Schedule: Dallas Cowboys');
      expect(res).toContain('Cowboys play Eagles on Sunday');
    });

    test('falls back to stored favorites when team is omitted', async () => {
      handleWebSearchTool.mockResolvedValue('some schedule results');
      const res = await handleSportsTool(makeMockDb(), 1, 'get_schedule', {});

      expect(handleWebSearchTool).toHaveBeenCalledTimes(2);
      expect(res).toContain('Schedule: Dallas Cowboys');
      expect(res).toContain('Schedule: Texas Rangers');
    });

    test('caps favorites lookups at 3 teams', async () => {
      handleWebSearchTool.mockResolvedValue('results');
      const db = makeMockDb({ favoriteTeams: ['A', 'B', 'C', 'D', 'E'] });
      await handleSportsTool(db, 1, 'get_schedule', {});
      expect(handleWebSearchTool).toHaveBeenCalledTimes(3);
    });

    test('returns guidance when no team given and no favorites saved', async () => {
      const res = await handleSportsTool(makeMockDb({ favoriteTeams: [] }), 1, 'get_schedule', {});
      expect(res).toContain('no favorite teams are saved');
      expect(handleWebSearchTool).not.toHaveBeenCalled();
    });
  });

  describe('get_live_game', () => {
    test('composes live-score and where-to-watch searches plus tracking links', async () => {
      handleWebSearchTool
        .mockResolvedValueOnce('Cowboys leading 21-14 in Q3')
        .mockResolvedValueOnce('Watch on FOX or stream on NFL+');

      const res = await handleSportsTool(makeMockDb(), 1, 'get_live_game', { team: 'Dallas Cowboys' });

      expect(handleWebSearchTool).toHaveBeenCalledTimes(2);
      const queries = handleWebSearchTool.mock.calls.map(c => c[2]);
      expect(queries.some(q => q.includes('live score'))).toBe(true);
      expect(queries.some(q => q.includes('where to watch'))).toBe(true);

      expect(res).toContain('Live Game Check: Dallas Cowboys');
      expect(res).toContain('Cowboys leading 21-14');
      expect(res).toContain('Watch on FOX');
      expect(res).toContain('espn.com');
      expect(res).toContain('Track the Live Score');
    });

    test('reports per-team error when searches fail', async () => {
      handleWebSearchTool.mockRejectedValue(new Error('Search offline'));
      const res = await handleSportsTool(makeMockDb(), 1, 'get_live_game', { team: 'Dallas Cowboys' });
      expect(res).toContain('Error retrieving live game info');
      expect(res).toContain('Search offline');
    });
  });

  describe('get_news', () => {
    test('scrapes Bleacher Report for a single explicit team (existing behavior)', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        text: async () => `
          <html><body>
            <a href="/articles/123"><h2>Big Cowboys Trade</h2></a>
          </body></html>`
      });

      const res = await handleSportsTool(makeMockDb(), 1, 'get_news', { team: 'Dallas Cowboys' });
      const parsed = JSON.parse(res);
      expect(parsed.status).toBe('success');
      expect(parsed.articles[0].title).toBe('Big Cowboys Trade');
    });

    test('falls back to Google News when Bleacher Report fails', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 503 });
      handleGoogleNewsTool.mockResolvedValue('## Google News results for Dallas Cowboys');

      const res = await handleSportsTool(makeMockDb(), 1, 'get_news', { team: 'Dallas Cowboys' });
      const parsed = JSON.parse(res);
      expect(parsed.status).toBe('fallback');
      expect(handleGoogleNewsTool).toHaveBeenCalledWith('Dallas Cowboys news');
      expect(parsed.results).toContain('Google News results');
    });

    test('iterates favorites with per-team sections when team omitted', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        text: async () => `<html><body><a href="/articles/1"><h2>Headline</h2></a></body></html>`
      });

      const res = await handleSportsTool(makeMockDb(), 1, 'get_news', {});
      expect(res).toContain('Dallas Cowboys');
      expect(res).toContain('Texas Rangers');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('returns guidance when no team given and no favorites saved', async () => {
      const res = await handleSportsTool(makeMockDb({ favoriteTeams: [] }), 1, 'get_news', {});
      expect(res).toContain('no favorite teams are saved');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
