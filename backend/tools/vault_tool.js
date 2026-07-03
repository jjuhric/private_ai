const fs = require('fs');
const path = require('path');
const { getEmbedding, getSemanticSimilarity } = require('../utils/embeddings');

/**
 * Handles document vault tool searches from the AI supervisor.
 * 
 * @param {import('sqlite').Database} db SQLite DB instance
 * @param {number} userId The user's ID
 * @param {string} action Action to perform: 'query'
 * @param {object} params Parameters for query
 * @returns {Promise<string>} Text results for Supervisor
 */
async function handleVaultTool(db, userId, action, params = {}) {
  if (!db) {
    return 'Error: Database connection is not available.';
  }

  try {
    if (action === 'query') {
      const { query } = params;
      if (!query || typeof query !== 'string' || query.trim() === '') {
        return 'Error: "query" parameter is required for Document Vault lookup.';
      }

      const cleanQuery = query.trim();
      const userSettings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [userId]) || {};
      const queryEmbedding = await getEmbedding(cleanQuery, userSettings);

      // Fetch all chunks and document info for this user
      const chunks = await db.all(`
        SELECT c.content, c.embedding, d.filename 
        FROM vault_chunks c
        JOIN vault_documents d ON c.document_id = d.id
        WHERE d.user_id = ?
      `, [userId]);

      if (chunks.length === 0) {
        return 'No documents are currently indexed in your Document Vault. Suggest that the user upload or write text/markdown documents to the Vault first.';
      }

      const scoredChunks = chunks.map(chunk => {
        let chunkEmbedding = null;
        if (chunk.embedding) {
          try {
            chunkEmbedding = JSON.parse(chunk.embedding);
          } catch (e) {}
        }
        const similarity = getSemanticSimilarity(cleanQuery, queryEmbedding, chunk.content, chunkEmbedding);
        return { ...chunk, similarity };
      });

      // Sort by similarity descending
      scoredChunks.sort((a, b) => b.similarity - a.similarity);

      // Filter by threshold
      const matches = scoredChunks.filter(c => c.similarity >= 0.35);

      if (matches.length === 0) {
        return 'No relevant sections from vault documents matched your query. Try rephrasing or searching for another term.';
      }

      const topMatches = matches.slice(0, 5);
      let report = `## 📄 Document Vault Retrieval Results for: *"${cleanQuery}"*\n\n`;
      topMatches.forEach((m, idx) => {
        report += `### ${idx + 1}. Source: **${m.filename}** (Relevance: ${(m.similarity * 100).toFixed(1)}%)\n`;
        report += `> ${m.content}\n\n`;
      });
      return report;
    }

    return `Error: Unknown Document Vault action "${action}".`;
  } catch (err) {
    console.error('Vault tool error:', err);
    return `Error searching document vault: ${err.message}`;
  }
}

/**
 * Splits text into overlapping chunks.
 * 
 * @param {string} text Full content
 * @param {number} size Chunk size in words
 * @param {number} overlap Overlap size in words
 * @returns {string[]} Array of chunks
 */
function chunkText(text, size = 150, overlap = 30) {
  if (!text) return [];
  const words = text.split(/\s+/);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk.trim()) {
      chunks.push(chunk);
    }
    i += (size - overlap);
  }
  return chunks;
}

/**
 * Indexes a text/markdown document by saving it to disk, chunking,
 * generating embeddings, and storing records in SQLite.
 * 
 * @param {import('sqlite').Database} db Database client
 * @param {number} userId User ID
 * @param {string} filename Original filename
 * @param {string} content Text file content
 */
async function indexDocument(db, userId, filename, content) {
  // Ensure Vault folder exists
  const vaultDir = path.join(process.cwd(), 'vault');
  if (!fs.existsSync(vaultDir)) {
    fs.mkdirSync(vaultDir, { recursive: true });
  }

  const filepath = path.join(vaultDir, `${Date.now()}_${filename}`);
  fs.writeFileSync(filepath, content, 'utf8');

  // Insert document info
  const result = await db.run(
    'INSERT INTO vault_documents (user_id, filename, filepath, file_size) VALUES (?, ?, ?, ?)',
    [userId, filename, filepath, Buffer.byteLength(content, 'utf8')]
  );
  const docId = result.lastID;

  // Chunk text
  const chunks = chunkText(content);
  const userSettings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [userId]) || {};

  // Insert chunks and embeddings
  for (const chunk of chunks) {
    const embedding = await getEmbedding(chunk, userSettings);
    await db.run(
      'INSERT INTO vault_chunks (document_id, content, embedding) VALUES (?, ?, ?)',
      [docId, chunk, embedding ? JSON.stringify(embedding) : null]
    );
  }
}

module.exports = { handleVaultTool, indexDocument, chunkText };
