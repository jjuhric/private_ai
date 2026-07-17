const { searchSystemDocs } = require('../utils/embeddings');

// Xenova's all-MiniLM-L6-v2 tends to produce lower cosine scores than the API-based
// embedding models used elsewhere (e.g. vault_tool's 0.35 threshold). Empirically,
// on-topic doc chunks score ~0.15-0.45 while unrelated queries score well under 0.12.
const SIMILARITY_THRESHOLD = 0.15;

/**
 * Handles queries against PATTI's own indexed README/wiki documentation, so
 * agents can ground answers about the system itself (architecture, how to
 * extend it, documented troubleshooting steps) instead of guessing.
 *
 * @param {string} action Action to perform: 'query'
 * @param {object} params Parameters for query: { query }
 * @returns {Promise<string>} Text results for the calling agent
 */
async function handleSystemDocsTool(action, params = {}) {
  if (action !== 'query') {
    return `Error: Unknown System Docs action "${action}".`;
  }

  const { query } = params;
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return 'Error: "query" parameter is required for System Docs lookup.';
  }

  const cleanQuery = query.trim();

  try {
    const results = await searchSystemDocs(cleanQuery, 5);
    const matches = results.filter(r => r.score >= SIMILARITY_THRESHOLD);

    if (matches.length === 0) {
      return 'No relevant sections from PATTI\'s own documentation matched your query. Try rephrasing, or answer from general knowledge if appropriate.';
    }

    let report = `## 📚 PATTI Documentation Retrieval Results for: *"${cleanQuery}"*\n\n`;
    matches.forEach((m, idx) => {
      const source = (m.metadata && m.metadata.source) || 'Unknown source';
      report += `### ${idx + 1}. Source: **${source}** (Relevance: ${(m.score * 100).toFixed(1)}%)\n`;
      report += `> ${m.text}\n\n`;
    });
    return report;
  } catch (err) {
    console.error('System docs tool error:', err);
    return `Error searching PATTI's documentation: ${err.message}`;
  }
}

module.exports = { handleSystemDocsTool };
