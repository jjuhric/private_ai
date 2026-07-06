const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getDb } = require('../db');

const os = require('os');
const net = require('net');

// Get local IPv4 subnet (e.g. "192.168.1")
function getLocalSubnet() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
      }
    }
  }
  return '192.168.1';
}

// TCP port checker utility
function checkIpPort(ip, port, timeout = 600) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isDone = false;
    
    socket.setTimeout(timeout);
    
    socket.on('connect', () => {
      socket.destroy();
      if (!isDone) {
        isDone = true;
        resolve(true);
      }
    });
    
    const handleError = () => {
      socket.destroy();
      if (!isDone) {
        isDone = true;
        resolve(false);
      }
    };
    
    socket.on('error', handleError);
    socket.on('timeout', handleError);
    
    socket.connect(port, ip);
  });
}

// Fetch node metadata safely
async function getDiscoveryPayload(ip, port = 3000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 800);
    const response = await fetch(`http://${ip}:${port}/api/nodes/discovery`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// Public discovery endpoint
router.get('/discovery', async (req, res) => {
  try {
    const db = await getDb();
    const settings = await db.get('SELECT device_type, is_main_host FROM user_settings LIMIT 1') || {};
    res.json({
      success: true,
      device_type: settings.device_type || 'unknown',
      is_main_host: settings.is_main_host === 1,
      port: process.env.PORT || 3000
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Authenticated network scan endpoint
router.post('/scan', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const existingNodes = (await db.all('SELECT ip_address, port FROM network_nodes WHERE user_id = ?', [req.user.id])) || [];
    const existingSet = new Set(existingNodes.map(n => `${n.ip_address}:${n.port}`));

    const subnet = getLocalSubnet();
    const port = process.env.PORT || 3000;
    const discovered = [];
    const ipList = [];
    
    for (let i = 1; i <= 254; i++) {
      ipList.push(`${subnet}.${i}`);
    }
    
    // Batch in chunks of 40 to avoid high connection overhead
    const batchSize = 40;
    for (let i = 0; i < ipList.length; i += batchSize) {
      const batch = ipList.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ip) => {
          if (existingSet.has(`${ip}:${port}`)) {
            return;
          }
          const isOpen = await checkIpPort(ip, port);
          if (isOpen) {
            const info = await getDiscoveryPayload(ip, port);
            if (info && info.success) {
              discovered.push({
                ip_address: ip,
                port: port,
                device_type: info.device_type,
                is_main_host: info.is_main_host
              });
            }
          }
        })
      );
    }
    
    res.json({ success: true, nodes: discovered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

  const targetPort = port || 3000;

  try {
    const db = await getDb();

    // Check if the node is already registered
    const existing = await db.get(
      'SELECT id FROM network_nodes WHERE user_id = ? AND ip_address = ? AND port = ?',
      [req.user.id, ip_address, targetPort]
    );
    if (existing) {
      return res.status(400).json({ error: 'Node with this IP address and port is already registered' });
    }

    const result = await db.run(
      'INSERT INTO network_nodes (user_id, node_name, device_type, ip_address, port, bridge_secret, last_seen, is_online) VALUES (?, ?, ?, ?, ?, ?, datetime("now"), 1)',
      [req.user.id, node_name, device_type, ip_address, targetPort, bridge_secret || null]
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
