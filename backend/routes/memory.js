const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// Get all active memories for the user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const memories = await db.all(
      'SELECT * FROM memories WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime(\'now\')) ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(memories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { content, level, expiresAt, days } = req.body;
  
  if (!content || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({ error: 'Content is required.' });
  }

  const memLevel = (level === 'short-term' || level === 'long-term') ? level : 'long-term';
  let finalExpiresAt = null;
  if (memLevel === 'short-term') {
    if (expiresAt) {
      const parsedDate = new Date(expiresAt);
      if (!isNaN(parsedDate.getTime())) {
        finalExpiresAt = parsedDate.toISOString();
      }
    }
    
    if (!finalExpiresAt && days && typeof days === 'number') {
      const date = new Date();
      date.setDate(date.getDate() + days);
      finalExpiresAt = date.toISOString();
    }

    if (!finalExpiresAt) {
      // Default to 30 days retention
      const date = new Date();
      date.setDate(date.getDate() + 30);
      finalExpiresAt = date.toISOString();
    }
  }

  try {
    const db = await getDb();
    
    // Check for existing active memory with the same content
    const existing = await db.get(
      'SELECT * FROM memories WHERE user_id = ? AND LOWER(content) = LOWER(?) AND (expires_at IS NULL OR expires_at > datetime(\'now\'))',
      [req.user.id, content.trim()]
    );

    if (existing) {
      return res.json({
        success: true,
        memory: existing,
        isDuplicate: true
      });
    }

    const result = await db.run(
      'INSERT INTO memories (user_id, content, level, expires_at) VALUES (?, ?, ?, ?)',
      [req.user.id, content.trim(), memLevel, finalExpiresAt]
    );

    res.json({
      success: true,
      memory: {
        id: result.lastID,
        user_id: req.user.id,
        content: content.trim(),
        level: memLevel,
        expires_at: finalExpiresAt,
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a memory
router.delete('/:id', authenticateToken, async (req, res) => {
  const memoryId = req.params.id;
  try {
    const db = await getDb();
    const result = await db.run(
      'DELETE FROM memories WHERE id = ? AND user_id = ?',
      [memoryId, req.user.id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Memory not found or not owned by user.' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
