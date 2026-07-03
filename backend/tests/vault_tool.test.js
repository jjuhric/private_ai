const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// Mock embeddings utility
jest.mock('../utils/embeddings', () => {
  return {
    getEmbedding: async (text) => {
      // Mock embedding values (1536 floats)
      return [0.1, 0.2, 0.3];
    },
    getSemanticSimilarity: (textA, vecA, textB, vecB) => {
      if (textA.includes('banana') || textB.includes('banana')) return 0.0;
      if (textA.includes('secret') && textB.includes('secret')) return 0.9;
      if (textA.includes('banana') && textB.includes('apple')) return 0.1;
      return 0.5;
    }
  };
});

const { handleVaultTool, indexDocument, chunkText } = require('../tools/vault_tool');

describe('Vault Tool RAG Tests', () => {
  let db;
  let userId = 1;

  beforeAll(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });
    const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
    await db.exec(schemaSql);
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
    
    // Clean up created vault test files
    const vaultDir = path.join(process.cwd(), 'vault');
    if (fs.existsSync(vaultDir)) {
      const files = fs.readdirSync(vaultDir);
      for (const file of files) {
        fs.unlinkSync(path.join(vaultDir, file));
      }
      fs.rmdirSync(vaultDir);
    }
  });

  test('chunkText should split content into overlapping pieces', () => {
    const text = 'one two three four five six seven eight nine ten';
    const chunks = chunkText(text, 5, 2);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toBe('one two three four five');
  });

  test('indexDocument should save document to db and chunk it', async () => {
    const filename = 'secret_recipe.txt';
    const content = 'This contains the secret recipe for the special cake.';

    await indexDocument(db, userId, filename, content);

    // Verify document was created
    const doc = await db.get('SELECT * FROM vault_documents WHERE user_id = ?', [userId]);
    expect(doc).toBeDefined();
    expect(doc.filename).toBe(filename);

    // Verify chunks were created
    const chunks = await db.all('SELECT * FROM vault_chunks WHERE document_id = ?', [doc.id]);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain('secret');
  });

  test('handleVaultTool query should return results for matched documents', async () => {
    const res = await handleVaultTool(db, userId, 'query', { query: 'What is the secret recipe?' });
    expect(res).toContain('secret_recipe.txt');
    expect(res).toContain('special cake');
  });

  test('handleVaultTool query should return no match on mismatch query', async () => {
    const res = await handleVaultTool(db, userId, 'query', { query: 'banana' });
    expect(res).toContain('No relevant sections from vault documents matched');
  });

  test('handleVaultTool should handle empty vault state', async () => {
    const emptyDb = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });
    const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
    await emptyDb.exec(schemaSql);

    const res = await handleVaultTool(emptyDb, userId, 'query', { query: 'hello' });
    expect(res).toContain('No documents are currently indexed');
    await emptyDb.close();
  });

  test('handleVaultTool error paths and invalid actions', async () => {
    const errorRes = await handleVaultTool(null, userId, 'query', { query: 'hello' });
    expect(errorRes).toContain('Database connection is not available');

    const invalidActionRes = await handleVaultTool(db, userId, 'invalid_action');
    expect(invalidActionRes).toContain('Unknown Document Vault action');

    const missingParamRes = await handleVaultTool(db, userId, 'query', {});
    expect(missingParamRes).toContain('Error: "query" parameter is required');
  });
});
