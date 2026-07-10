const cheerio = require('cheerio');

async function handleSportsTool(db, userId, action, params) {
  if (action !== 'get_news') {
    return JSON.stringify({ error: `Unknown action: ${action}` });
  }

  const { team } = params;
  if (!team) {
    return JSON.stringify({ error: 'Team name is required' });
  }

  try {
    // Generate team slug (lowercase, replace spaces/special chars with hyphens)
    const teamSlug = team
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // remove special characters
      .trim()
      .replace(/\s+/g, '-');

    const url = `https://bleacherreport.com/${teamSlug}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

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
    return JSON.stringify({ error: `Failed to retrieve sports news: ${err.message}` });
  }
}

module.exports = { handleSportsTool };
