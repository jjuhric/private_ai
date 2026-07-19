const cheerio = require('cheerio');

// Cap multi-team composed lookups so a long favorites list can't fan out into
// a dozen sequential web searches per chat turn.
const MAX_FAVORITE_TEAMS_PER_LOOKUP = 3;

// ESPN's schedule pages are keyed by team abbreviation, not name, and are a
// real structured source (unlike generic web search, which returns nothing
// useful for "upcoming games" during the offseason since there's no live
// article discussing a future schedule).
const NFL_TEAM_ESPN_ABBR = {
  'arizona cardinals': 'ari', cardinals: 'ari',
  'atlanta falcons': 'atl', falcons: 'atl',
  'baltimore ravens': 'bal', ravens: 'bal',
  'buffalo bills': 'buf', bills: 'buf',
  'carolina panthers': 'car', panthers: 'car',
  'chicago bears': 'chi', bears: 'chi',
  'cincinnati bengals': 'cin', bengals: 'cin',
  'cleveland browns': 'cle', browns: 'cle',
  'dallas cowboys': 'dal', cowboys: 'dal',
  'denver broncos': 'den', broncos: 'den',
  'detroit lions': 'det', lions: 'det',
  'green bay packers': 'gb', packers: 'gb',
  'houston texans': 'hou', texans: 'hou',
  'indianapolis colts': 'ind', colts: 'ind',
  'jacksonville jaguars': 'jax', jaguars: 'jax',
  'kansas city chiefs': 'kc', chiefs: 'kc',
  'las vegas raiders': 'lv', raiders: 'lv',
  'los angeles chargers': 'lac', chargers: 'lac',
  'los angeles rams': 'lar', rams: 'lar',
  'miami dolphins': 'mia', dolphins: 'mia',
  'minnesota vikings': 'min', vikings: 'min',
  'new england patriots': 'ne', patriots: 'ne',
  'new orleans saints': 'no', saints: 'no',
  'new york giants': 'nyg', giants: 'nyg',
  'new york jets': 'nyj', jets: 'nyj',
  'philadelphia eagles': 'phi', eagles: 'phi',
  'pittsburgh steelers': 'pit', steelers: 'pit',
  'san francisco 49ers': 'sf', '49ers': 'sf', niners: 'sf',
  'seattle seahawks': 'sea', seahawks: 'sea',
  'tampa bay buccaneers': 'tb', buccaneers: 'tb', bucs: 'tb',
  'tennessee titans': 'ten', titans: 'ten',
  'washington commanders': 'wsh', commanders: 'wsh'
};

function resolveEspnNflAbbreviation(team) {
  const key = String(team || '').trim().toLowerCase();
  if (NFL_TEAM_ESPN_ABBR[key]) return NFL_TEAM_ESPN_ABBR[key];
  const lastWord = key.split(/\s+/).pop();
  return NFL_TEAM_ESPN_ABBR[lastWord] || null;
}

/**
 * Fetches a team's regular season schedule from ESPN's public, unauthenticated
 * JSON API (site.api.espn.com) - a real structured source, unlike generic web
 * search which returns nothing usable for "upcoming games" outside the season.
 * Note: ESPN's HTML schedule pages (www.espn.com) sit behind an AWS WAF
 * JavaScript challenge and cannot be scraped directly with a plain fetch;
 * this JSON API is a separate, unprotected endpoint used by ESPN's own apps.
 * Returns null (rather than throwing) when the team isn't a recognized NFL
 * team, so the caller can fall back to web search for other sports.
 */
async function getTeamScheduleFromEspn(team) {
  const abbr = resolveEspnNflAbbreviation(team);
  if (!abbr) return null;

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${abbr}/schedule`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ESPN schedule API: status ${response.status}`);
  }

  const data = await response.json();
  const events = Array.isArray(data.events) ? data.events : [];
  const teamAbbrUpper = abbr.toUpperCase();

  const games = events.map(event => {
    const competition = (event.competitions && event.competitions[0]) || {};
    const competitors = competition.competitors || [];
    const self = competitors.find(c => c.team && c.team.abbreviation === teamAbbrUpper);
    const opponentEntry = competitors.find(c => c.team && c.team.abbreviation !== teamAbbrUpper);

    const broadcasts = (competition.broadcasts || [])
      .map(b => b.media && b.media.shortName)
      .filter(Boolean);

    return {
      week: event.week ? event.week.number : null,
      season_type: event.seasonType ? event.seasonType.name : null,
      date_utc: event.date || null,
      opponent: opponentEntry && opponentEntry.team ? opponentEntry.team.displayName : null,
      home_or_away: self ? self.homeAway : null,
      network: broadcasts.length > 0 ? broadcasts.join('/') : 'TBD'
    };
  }).filter(g => g.week !== null);

  // ESPN's schedule API omits the bye week entirely rather than listing it,
  // so detect the gap in week numbers within the regular season range.
  const regSeasonWeeks = games.filter(g => g.season_type === 'Regular Season').map(g => g.week);
  if (regSeasonWeeks.length > 0) {
    const maxWeek = Math.max(...regSeasonWeeks);
    for (let w = 1; w <= maxWeek; w++) {
      if (!regSeasonWeeks.includes(w)) {
        games.push({ week: w, season_type: 'Regular Season', date_utc: null, opponent: 'BYE WEEK', home_or_away: null, network: null });
      }
    }
    games.sort((a, b) => a.week - b.week);
  }

  return { team, source: 'ESPN', games };
}

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
    // Note: web-search query wording deliberately avoids the word "news" -
    // web_search_tool reroutes news-matching queries to Google News, which
    // is wrong for schedules. It's only used as a fallback for non-NFL teams
    // or if the ESPN API lookup below fails - generic web search returns
    // nothing useful for "upcoming games" outside the season otherwise.
    const sections = await Promise.all(
      teams.map(async (team) => {
        try {
          const espnResult = await getTeamScheduleFromEspn(team);
          if (espnResult && espnResult.games.length > 0) {
            return `## 📅 Schedule: ${team}\n${JSON.stringify(espnResult)}`;
          }
        } catch (err) {
          // Fall through to web search below.
        }
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
