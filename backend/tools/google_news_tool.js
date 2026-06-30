const { GoogleDecoder } = require('google-news-url-decoder');
const { extractFirst100Words } = require('../utils/helpers');

// Google News tool operations
async function handleGoogleNewsTool(query) {
  try {
    const rssUrl = query
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
      : 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';
      
    const response = await fetch(rssUrl);
    if (!response.ok) throw new Error('Failed to fetch news RSS feed');
    const xml = await response.text();

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    const articles = [];

    while ((match = itemRegex.exec(xml)) !== null && articles.length < 30) {
      const block = match[1];
      const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1];
      const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1];
      if (title && link) {
        articles.push({
          headline: title.replace(/<[^>]*>/g, '').trim(),
          link: link.trim()
        });
      }
    }

    const decoder = new GoogleDecoder();
    const scrapedArticles = await Promise.all(
      articles.map(async (art, index) => {
        try {
          let destinationLink = art.link;
          try {
            const decoded = await decoder.decode(art.link);
            if (decoded && decoded.status) {
              destinationLink = decoded.decoded_url;
            }
          } catch (decodeErr) {
            console.warn(`Failed to decode URL for "${art.headline}":`, decodeErr.message);
          }

          // Limit intensive web scraping to the top 10 articles to protect performance and bandwidth
          if (index >= 10) {
            return {
              headline: art.headline,
              link: destinationLink,
              content: 'Headline and link only (content not scraped to save bandwidth/time).'
            };
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          
          const destRes = await fetch(destinationLink, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          const destHtml = await destRes.text();
          const snippet = extractFirst100Words(destHtml);
          return {
            headline: art.headline,
            link: destinationLink,
            content: snippet
          };
        } catch (err) {
          console.error(`Failed to scrape article "${art.headline}":`, err.message);
          return {
            headline: art.headline,
            link: art.link,
            content: 'Failed to scrape full text from destination server.'
          };
        }
      })
    );

    return JSON.stringify({
      source: query ? `Google News (Search: "${query}")` : 'Google News (Top Stories)',
      articles: scrapedArticles
    });
  } catch (err) {
    return JSON.stringify({ error: `News fetch failed: ${err.message}` });
  }
}

module.exports = { handleGoogleNewsTool };
