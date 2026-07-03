const express = require('express');
const router = express.Router();
const fs = require('fs');
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { indexDocument } = require('../tools/vault_tool');

// Get all indexed documents in the vault
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const docs = await db.all(
      'SELECT id, filename, file_size, created_at FROM vault_documents WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload and index a text/markdown document
router.post('/', authenticateToken, async (req, res) => {
  const { filename, content } = req.body;
  if (!filename || !content || content.trim() === '') {
    return res.status(400).json({ error: 'Filename and content are required.' });
  }

  try {
    const db = await getDb();
    await indexDocument(db, req.user.id, filename.trim(), content);
    res.json({ success: true, message: `Document "${filename}" indexed successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a document from the vault
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    
    // Find the file first to delete it from disk
    const doc = await db.get(
      'SELECT filepath FROM vault_documents WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Delete physical file
    try {
      if (fs.existsSync(doc.filepath)) {
        fs.unlinkSync(doc.filepath);
      }
    } catch (fsErr) {
      console.warn(`Could not delete file from disk: ${doc.filepath}`, fsErr.message);
    }

    // Delete database entry (cascades to vault_chunks automatically)
    await db.run(
      'DELETE FROM vault_documents WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    res.json({ success: true, message: 'Document deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
