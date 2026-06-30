const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get('SELECT name, zipcode, country, temp_unit, weather_api_key FROM users WHERE id = ?', [req.user.id]);
    res.json(user || { name: '', zipcode: '', country: 'US', temp_unit: 'imperial', weather_api_key: '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', authenticateToken, async (req, res) => {
  const { name, zipcode, country, temp_unit, weather_api_key } = req.body;
  try {
    const db = await getDb();
    await db.run(
      `UPDATE users SET name = ?, zipcode = ?, country = ?, temp_unit = ?, weather_api_key = ? WHERE id = ?`,
      [name || '', zipcode || '', country || 'US', temp_unit || 'imperial', weather_api_key || '', req.user.id]
    );
    res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
