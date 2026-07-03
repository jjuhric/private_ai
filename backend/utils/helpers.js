const cheerio = require('cheerio');

function extractFirst100Words(html) {
  if (!html) return '';
  try {
    const $ = cheerio.load(html);
    // Remove interactive, media, layout and style blocks
    $('script, style, head, nav, footer, header, iframe, noscript, svg, img').remove();
    
    const text = $('body').text()
      .replace(/\s+/g, ' ')
      .trim();
      
    const words = text.split(/\s+/).slice(0, 100);
    return words.join(' ') + (words.length >= 100 ? '...' : '');
  } catch (err) {
    // Fallback regex parsing
    let text = html
      .replace(/<head>[\s\S]*?<\/head>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
      
    const words = text.split(/\s+/).slice(0, 100);
    return words.join(' ') + (words.length >= 100 ? '...' : '');
  }
}

module.exports = { extractFirst100Words };
