const cheerio = require('cheerio');

// Cap multi-team composed lookups so a long favorites list can't fan out into
// a dozen sequential web searches per chat turn.
const MAX_FAVORITE_TEAMS_PER_LOOKUP = 3;

/**
 * Reads the user's stored favorite teams (users.favorite_teams JSON array).
 * Mirrors how news_tool reads users.interests directly in-tool.
 */
async function resolveFavoriteTeams(db, userId) {
  if (!db || !userId) return [];
  try {
    const row = await db.get('SELECT favorite_teams FROM users WHERE id = ?', [userId]);
    const parsed = JSON.parse((row && row.favorite_teams) || '[]');
    return Array.isArray(parsed) ? parsed.filter(t => typeof t === 'string' && t.trim()) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Resolves which team(s) an action should run against: the explicitly passed
 * team, or the user's stored favorites when the team param is omitted.
 * Returns { teams, error } where error is a ready-to-return message string.
 */
async function resolveTargetTeams(db, userId, params = {}) {
  const team = params.team && String(params.team).trim();
  if (team) return { teams: [team] };

  const favorites = await resolveFavoriteTeams(db, userId);
  if (favorites.length === 0) {
    return {
      teams: [],
      error: 'No team was specified and no favorite teams are saved. Ask the user which team they mean, and suggest adding favorite teams in their Profile so PATTI remembers them.'
    };
  }
  return { teams: favorites.slice(0, MAX_FAVORITE_TEAMS_PER_LOOKUP) };
}

/**
 * Scrapes Bleacher Report news for a single team. Returns the same JSON string
 * shapes the sports agent already understands (status: success | all_seen | error).
 */
async function getTeamNews(db, userId, team) {
  try {
    // Generate team slug (lowercase, replace spaces/special chars with hyphens)
    const teamSlug = team
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // remove special characters
      .trim()
      .replace(/\s+/g, '-');

    const url = `https://bleacherreport.com/${teamSlug}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 seconds timeout for direct scrape
    let response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch Bleacher Report page: status ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const isArticleLink = href.includes('utm_source=bleacherreport') || href.startsWith('/articles/');
      if (!isArticleLink) return;

      // Extract title
      const titleEl = $(el).find('h2');
      const title = titleEl.text().trim();
      if (!title) return;

      // Extract description/subtext
      const descEl = $(el).find('span.MuiTypography-bp_small__body__body__large, span.MuiTypography-root[class*="body__large"]');
      const description = descEl.text().trim();

      // Extract source domain
      let sourceLinkText = '';
      $(el).find('span').each((j, spanEl) => {
        const txt = $(spanEl).text().trim();
        if (txt.includes('www.') || txt.includes('.com') || txt.includes('.org') || txt.includes('.net')) {
          sourceLinkText = txt.split('•')[0].trim();
        }
      });

      if (!sourceLinkText) {
        try {
          const urlObj = new URL(href.startsWith('/') ? 'https://bleacherreport.com' + href : href);
          sourceLinkText = urlObj.hostname.replace('www.', '');
        } catch (e) {
          sourceLinkText = 'bleacherreport.com';
        }
      }

      results.push({
        link: href.startsWith('/') ? 'https://bleacherreport.com' + href : href,
        source: sourceLinkText,
        title: title,
        extra_info: description || 'No subtext details available.'
      });
    });

    // Remove duplicates by title
    const uniqueScraped = [];
    const seenTitles = new Set();
    for (const item of results) {
      if (!seenTitles.has(item.title)) {
        seenTitles.add(item.title);
        uniqueScraped.push(item);
      }
    }

    // Now, query seen articles from database
    let seenLinks = new Set();
    if (db && userId) {
      const rows = await db.all('SELECT article_link FROM shown_articles WHERE user_id = ?', [userId]);
      seenLinks = new Set(rows.map(r => r.article_link));
    }

    // Filter out seen articles
    const unseenArticles = uniqueScraped.filter(item => !seenLinks.has(item.link));

    // If all articles have been seen, return a fallback showing what was seen today
    if (unseenArticles.length === 0) {
      let seenToday = [];
      if (db && userId) {
        seenToday = await db.all(
          `SELECT article_link AS link, title, 'bleacherreport.com' AS source
           FROM shown_articles
           WHERE user_id = ? AND date(seen_at, 'localtime') = date('now', 'localtime')`,
          [userId]
        );
      }
      return JSON.stringify({
        source: `Bleacher Report (${team})`,
        status: 'all_seen',
        message: `You have seen all the articles for today about ${team}.`,
        articles: seenToday
      });
    }

    // Select up to 10 articles to show
    const articlesToShow = unseenArticles.slice(0, 10);

    // Record these as seen in the database so they won't be shown next time
    if (db && userId && articlesToShow.length > 0) {
      const insertStmt = `INSERT OR IGNORE INTO shown_articles (user_id, article_link, title) VALUES (?, ?, ?)`;
      for (const item of articlesToShow) {
        try {
          await db.run(insertStmt, [userId, item.link, item.title]);
        } catch (dbErr) {
          console.error('Failed to record shown article:', dbErr.message);
        }
      }
    }

    return JSON.stringify({
      source: `Bleacher Report (${team})`,
      status: 'success',
      articles: articlesToShow.map(item => ({
        link: item.link,
        title: item.title,
        extra_info: item.extra_info,
        source: item.source
      }))
    });
  } catch (err) {
    // Bleacher Report scrape failed - fall back to a Google News lookup so the
    // user still gets current articles instead of a dead end.
    try {
      const { handleGoogleNewsTool } = require('./google_news_tool');
      const newsResult = await handleGoogleNewsTool(`${team} news`);
      return JSON.stringify({
        source: `Google News (${team})`,
        status: 'fallback',
        message: `Bleacher Report was unreachable (${err.message}); showing Google News results instead.`,
        results: newsResult
      });
    } catch (fallbackErr) {
      return JSON.stringify({ error: `Failed to retrieve sports news: ${err.message}` });
    }
  }
}

async function handleSportsTool(db, userId, action, params = {}) {
  if (action === 'get_favorite_teams') {
    const favorites = await resolveFavoriteTeams(db, userId);
    if (favorites.length === 0) {
      return 'The user has no favorite teams saved yet. Suggest adding them in the Profile settings under "Favorite Teams".';
    }
    return `### ⭐ The user's favorite teams:\n${favorites.map(t => `- ${t}`).join('\n')}`;
  }

  if (action === 'get_news') {
    const { teams, error } = await resolveTargetTeams(db, userId, params);
    if (error) return error;

    if (teams.length === 1) {
      return getTeamNews(db, userId, teams[0]);
    }
    const sections = [];
    for (const team of teams) {
      const result = await getTeamNews(db, userId, team);
      sections.push(`## 🏟️ ${team}\n${result}`);
    }
    return sections.join('\n\n');
  }

  if (action === 'get_schedule') {
    const { teams, error } = await resolveTargetTeams(db, userId, params);
    if (error) return error;

    const { handleWebSearchTool } = require('./web_search_tool');
    // Note: query wording deliberately avoids the word "news" - web_search_tool
    // reroutes news-matching queries to Google News, which is wrong for schedules.
    const sections = await Promise.all(
      teams.map(async (team) => {
        try {
          const result = await handleWebSearchTool(db, userId, `${team} upcoming game schedule this week`);
          return `## 📅 Schedule: ${team}\n${result}`;
        } catch (err) {
          return `## 📅 Schedule: ${team}\nError retrieving schedule: ${err.message}`;
        }
      })
    );
    return sections.join('\n\n');
  }

  if (action === 'get_live_game') {
    const { teams, error } = await resolveTargetTeams(db, userId, params);
    if (error) return error;

    const { handleWebSearchTool } = require('./web_search_tool');
    const sections = await Promise.all(
      teams.map(async (team) => {
        try {
          const [liveInfo, watchInfo] = await Promise.all([
            handleWebSearchTool(db, userId, `${team} game today live score`),
            handleWebSearchTool(db, userId, `where to watch ${team} game today TV channel streaming`)
          ]);
          return [
            `## 🔴 Live Game Check: ${team}`,
            `### Current Game / Score Info\n${liveInfo}`,
            `### Where to Watch\n${watchInfo}`,
            `### Track the Live Score\n- [ESPN Scoreboard](https://www.espn.com/search/results?q=${encodeURIComponent(team)})\n- [Google Live Score](https://www.google.com/search?q=${encodeURIComponent(team + ' score')})`
          ].join('\n\n');
        } catch (err) {
          return `## 🔴 Live Game Check: ${team}\nError retrieving live game info: ${err.message}`;
        }
      })
    );
    return sections.join('\n\n');
  }

  return JSON.stringify({ error: `Unknown action: ${action}` });
}

module.exports = { handleSportsTool };
