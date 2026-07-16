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

function extractThoughts(rawContent, existingThoughts = '') {
  let finalContent = rawContent || '';
  let finalThoughts = existingThoughts || '';

  const startTag = '<|channel>thought';
  const endTag = '<channel|>';
  if (finalContent.includes(startTag)) {
    const startIdx = finalContent.indexOf(startTag);
    const endIdx = finalContent.indexOf(endTag);
    if (endIdx !== -1) {
      const extractedThoughts = finalContent.substring(startIdx + startTag.length, endIdx).trim();
      finalThoughts = (finalThoughts + '\n' + extractedThoughts).trim();
      finalContent = (finalContent.substring(0, startIdx) + finalContent.substring(endIdx + endTag.length)).trim();
    } else {
      const extractedThoughts = finalContent.substring(startIdx + startTag.length).trim();
      finalThoughts = (finalThoughts + '\n' + extractedThoughts).trim();
      finalContent = finalContent.substring(0, startIdx).trim();
    }
  }

  const startTagXml = '<think>';
  const endTagXml = '</think>';
  if (finalContent.includes(startTagXml)) {
    const startIdx = finalContent.indexOf(startTagXml);
    const endIdx = finalContent.indexOf(endTagXml);
    if (endIdx !== -1) {
      const extractedThoughts = finalContent.substring(startIdx + startTagXml.length, endIdx).trim();
      finalThoughts = (finalThoughts + '\n' + extractedThoughts).trim();
      finalContent = (finalContent.substring(0, startIdx) + finalContent.substring(endIdx + endTagXml.length)).trim();
    } else {
      const extractedThoughts = finalContent.substring(startIdx + startTagXml.length).trim();
      finalThoughts = (finalThoughts + '\n' + extractedThoughts).trim();
      finalContent = finalContent.substring(0, startIdx).trim();
    }
  }

  return { content: finalContent, thoughts: finalThoughts };
}

module.exports = { extractFirst100Words, extractThoughts };
