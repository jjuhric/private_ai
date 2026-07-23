/**
 * Parses a lightweight markdown subset (#/##/### headings, -/* bullets,
 * [text](url) inline links, blank-line-separated paragraphs) into a block
 * array shared by the PDF and DOCX document generators.
 *
 * @param {string} markdown
 * @returns {Array<{type: 'heading'|'bullet'|'paragraph', level?: number, runs: Array<{text: string, url?: string}>}>}
 */
function markdownToBlocks(markdown) {
  const lines = (markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];

  const flush = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', runs: parseInlineLinks(para.join(' ').trim()) });
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, runs: parseInlineLinks(heading[2]) });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flush();
      blocks.push({ type: 'bullet', runs: parseInlineLinks(bullet[1]) });
      continue;
    }
    para.push(line);
  }
  flush();

  return blocks;
}

/**
 * Splits a line of text into runs, extracting [text](url) links so a link
 * can sit mid-sentence or mid-bullet.
 *
 * @param {string} text
 * @returns {Array<{text: string, url?: string}>}
 */
function parseInlineLinks(text) {
  const runs = [];
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    if (match.index > last) {
      runs.push({ text: text.slice(last, match.index) });
    }
    runs.push({ text: match[1], url: match[2] });
    last = linkPattern.lastIndex;
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last) });
  }
  return runs.length ? runs : [{ text }];
}

module.exports = { markdownToBlocks, parseInlineLinks };
