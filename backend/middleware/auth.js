const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_private_ai_assistant_2026';

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required.' });

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expired or invalid.' });
    
    try {
      const db = await getDb();
      const dbUser = await db.get('SELECT id FROM users WHERE id = ?', [user.id]);
      if (!dbUser) {
        return res.status(401).json({ error: 'Stale session: User no longer exists.' });
      }
    } catch (dbErr) {
      console.warn('Database user check failed during authentication, proceeding with JWT payload:', dbErr.message);
    }
    
    req.user = user;
    next();
  });
}

module.exports = { authenticateToken, JWT_SECRET };
