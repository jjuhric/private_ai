const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get('SELECT name, zipcode, country, temp_unit, weather_api_key FROM users WHERE id = ?', [req.user.id]);
    
    if (user) {
      const { decrypt } = require('../utils/crypto');
      const maskKey = (key) => {
        if (!key) return '';
        const dec = decrypt(key);
        if (dec.length <= 8) return '••••••••';
        return dec.substring(0, 4) + '••••••••' + dec.substring(dec.length - 4);
      };
      user.weather_api_key = user.weather_api_key ? maskKey(user.weather_api_key) : user.weather_api_key;
    }

    res.json(user || { name: '', zipcode: '', country: 'US', temp_unit: 'imperial', weather_api_key: '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', authenticateToken, async (req, res) => {
  const { name, zipcode, country, temp_unit, weather_api_key } = req.body;
  try {
    const db = await getDb();
    const { encrypt } = require('../utils/crypto');
    const existing = await db.get('SELECT weather_api_key FROM users WHERE id = ?', [req.user.id]);
    const isMasked = (val) => val && val.includes('••');
    
    const finalWeatherKey = isMasked(weather_api_key) 
      ? existing?.weather_api_key 
      : (weather_api_key ? encrypt(weather_api_key) : null);

    await db.run(
      `UPDATE users SET name = ?, zipcode = ?, country = ?, temp_unit = ?, weather_api_key = ? WHERE id = ?`,
      [name || '', zipcode || '', country || 'US', temp_unit || 'imperial', finalWeatherKey, req.user.id]
    );
    res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
