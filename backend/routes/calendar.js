const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, async (req, res) => {
  const { date } = req.query; // YYYY-MM-DD
  try {
    const db = await getDb();
    const queryDate = date || new Date().toISOString().split('T')[0];
    const events = await db.all(
      `SELECT * FROM calendar_events 
       WHERE user_id = ? AND (start_time LIKE ? OR date(start_time) = date(?))
       ORDER BY start_time ASC`,
      [req.user.id, `${queryDate}%`, queryDate]
    );
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { title, description, start_time, end_time } = req.body;
  if (!title || !start_time) return res.status(400).json({ error: 'Title and start_time are required' });

  try {
    const db = await getDb();
    const result = await db.run(
      `INSERT INTO calendar_events (user_id, title, description, start_time, end_time) 
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, title, description || '', start_time, end_time || start_time]
    );
    res.json({ success: true, eventId: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM calendar_events WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
