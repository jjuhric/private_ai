const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getDb } = require('../db');

// Get all network nodes
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const nodes = await db.all('SELECT id, node_name, device_type, ip_address, port, last_seen, is_online, created_at FROM network_nodes WHERE user_id = ?', [req.user.id]);
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new node
router.post('/', authenticateToken, async (req, res) => {
  const { node_name, device_type, ip_address, port, bridge_secret } = req.body;
  
  if (!node_name || !device_type || !ip_address) {
    return res.status(400).json({ error: 'node_name, device_type, and ip_address are required' });
  }

  try {
    const db = await getDb();
    const result = await db.run(
      'INSERT INTO network_nodes (user_id, node_name, device_type, ip_address, port, bridge_secret, last_seen, is_online) VALUES (?, ?, ?, ?, ?, ?, datetime("now"), 1)',
      [req.user.id, node_name, device_type, ip_address, port || 3000, bridge_secret || null]
    );
    
    res.json({ id: result.lastID, success: true, message: 'Node added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a node
router.put('/:id', authenticateToken, async (req, res) => {
  const { node_name, device_type, ip_address, port, is_online } = req.body;
  const { id } = req.params;

  try {
    const db = await getDb();
    await db.run(
      'UPDATE network_nodes SET node_name = ?, device_type = ?, ip_address = ?, port = ?, is_online = ? WHERE id = ? AND user_id = ?',
      [node_name, device_type, ip_address, port, is_online, id, req.user.id]
    );
    res.json({ success: true, message: 'Node updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a node
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    await db.run('DELETE FROM network_nodes WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true, message: 'Node deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ping a node to update last_seen and online status (simulated heartbeat)
router.post('/:id/ping', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    await db.run('UPDATE network_nodes SET last_seen = datetime("now"), is_online = 1 WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
