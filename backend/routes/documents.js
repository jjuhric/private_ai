const express = require('express');
const router = express.Router();
const fs = require('fs');
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// List all documents generated for the current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const docs = await db.all(
      'SELECT id, filename, doc_type, file_size, created_at FROM generated_documents WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download a generated document
router.get('/:id/download', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.get(
      'SELECT filepath, filename FROM generated_documents WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!doc || !fs.existsSync(doc.filepath)) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    res.download(doc.filepath, doc.filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a generated document
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();

    const doc = await db.get(
      'SELECT filepath FROM generated_documents WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    try {
      if (fs.existsSync(doc.filepath)) {
        fs.unlinkSync(doc.filepath);
      }
    } catch (fsErr) {
      console.warn(`Could not delete generated document from disk: ${doc.filepath}`, fsErr.message);
    }

    await db.run('DELETE FROM generated_documents WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

    res.json({ success: true, message: 'Document deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
