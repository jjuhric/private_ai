function extractFirst100Words(html) {
  let text = html
    .replace(/<head>[\s\S]*?<\/head>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  const words = text.split(/\s+/).slice(0, 100);
  return words.join(' ') + '...';
}

module.exports = { extractFirst100Words };
