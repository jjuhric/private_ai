const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getDb } = require('../db');
const { encrypt, decrypt } = require('../utils/crypto');

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

// Get all local IPv4 addresses of this machine
function getLocalIps() {
  const ips = new Set(['127.0.0.1', 'localhost']);
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const netObj of interfaces[name]) {
      if (netObj.family === 'IPv4') {
        ips.add(netObj.address);
      }
    }
  }
  return ips;
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
    const subnet = getLocalSubnet();
    const localIps = getLocalIps();
    const discovered = [];
    const ipList = [];
    
    for (let i = 2; i <= 254; i++) {
      const ip = `${subnet}.${i}`;
      if (ip !== '192.168.1.1') {
        ipList.push(ip);
      }
    }
    
    const portsToProbe = [3000, 80, 8009];
    const batchSize = 40;
    
    for (let i = 0; i < ipList.length; i += batchSize) {
      const batch = ipList.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ip) => {
          if (localIps.has(ip)) {
            return;
          }
          
          for (const targetPort of portsToProbe) {
            const isOpen = await checkIpPort(ip, targetPort, 200);
            if (isOpen) {
              let name = 'Unknown Device';
              let deviceType = 'Generic Node';
              let rawDeviceType = null;
              
              if (targetPort === 8009) {
                name = 'Google Assistant Speaker';
                deviceType = 'Google Assistant';
              } else if (targetPort === 3000) {
                const info = await getDiscoveryPayload(ip, 3000);
                if (info && info.success) {
                  if (info.is_main_host) {
                    return;
                  }
                  rawDeviceType = info.device_type;
                  const isRpi = info.device_type && info.device_type.toLowerCase().includes('rpi');
                  name = info.device_type === 'windows' ? 'Windows Host' : (isRpi ? 'Raspberry Pi' : 'Private AI Node');
                  deviceType = info.device_type === 'windows' ? 'Windows' : (isRpi ? 'RPi' : 'Windows');
                }
              } else if (targetPort === 80) {
                let isEsp = false;
                try {
                  const controller = new AbortController();
                  const tId = setTimeout(() => controller.abort(), 1000);
                  const testRes = await fetch(`http://${ip}/health`, {
                    signal: controller.signal
                  });
                  clearTimeout(tId);
                  if (testRes.ok) {
                    const data = await testRes.json();
                    if (data && data.deviceReachable) {
                      isEsp = true;
                    }
                  }
                } catch (e) {}
                
                if (isEsp) {
                  name = 'ESP32 Device';
                  deviceType = 'ESP32';
                } else {
                  continue;
                }
              }
              
              const exist = await db.get(
                'SELECT id, device_type, node_name FROM network_nodes WHERE user_id = ? AND ip_address = ?',
                [req.user.id, ip]
              );
              
              if (!exist) {
                await db.run(
                  'INSERT INTO network_nodes (user_id, node_name, device_type, ip_address, port, is_online, last_seen) VALUES (?, ?, ?, ?, ?, 1, datetime("now"))',
                  [req.user.id, name, deviceType, ip, targetPort]
                );
              } else {
                // Keep node_name and device_type paired together: if we're preserving the
                // existing (already-identified) name, preserve its device_type too rather
                // than letting this scan's classification overwrite just the type and leave
                // a stale name/type combination (e.g. "Web Server / Router" tagged as ESP32).
                const keepExisting = exist.node_name && !exist.node_name.startsWith('Google Cast Device') && !exist.node_name.startsWith('Google Assistant Speaker');
                const finalName = keepExisting ? exist.node_name : name;
                const finalDeviceType = exist.device_type === 'google_home'
                  ? 'google_home'
                  : (keepExisting ? exist.device_type : deviceType);

                await db.run(
                  'UPDATE network_nodes SET is_online = 1, last_seen = datetime("now"), node_name = ?, device_type = ?, port = ? WHERE id = ?',
                  [finalName, finalDeviceType, targetPort, exist.id]
                );
              }
              
              discovered.push({
                ip_address: ip,
                port: targetPort,
                device_type: rawDeviceType || deviceType,
                node_name: name
              });
              break;
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
    const nodes = await db.all('SELECT id, node_name, device_type, ip_address, port, last_seen, is_online, created_at, ssh_username, ssh_password, ssh_key FROM network_nodes WHERE user_id = ?', [req.user.id]);
    const decryptedNodes = nodes.map(node => ({
      ...node,
      ssh_password: node.ssh_password ? decrypt(node.ssh_password) : '',
      ssh_key: node.ssh_key ? decrypt(node.ssh_key) : ''
    }));
    res.json(decryptedNodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new node
router.post('/', authenticateToken, async (req, res) => {
  const { node_name, device_type, ip_address, port, bridge_secret, ssh_username, ssh_password, ssh_key } = req.body;
  
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

    const encPassword = ssh_password ? encrypt(ssh_password) : null;
    const encKey = ssh_key ? encrypt(ssh_key) : null;

    const result = await db.run(
      'INSERT INTO network_nodes (user_id, node_name, device_type, ip_address, port, bridge_secret, last_seen, is_online, ssh_username, ssh_password, ssh_key) VALUES (?, ?, ?, ?, ?, ?, datetime("now"), 1, ?, ?, ?)',
      [req.user.id, node_name, device_type, ip_address, targetPort, bridge_secret || null, ssh_username || null, encPassword, encKey]
    );
    
    res.json({ id: result.lastID, success: true, message: 'Node added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a node
router.put('/:id', authenticateToken, async (req, res) => {
  const { node_name, device_type, ip_address, port, is_online, ssh_username, ssh_password, ssh_key } = req.body;
  const { id } = req.params;

  try {
    const db = await getDb();
    
    const encPassword = ssh_password ? encrypt(ssh_password) : null;
    const encKey = ssh_key ? encrypt(ssh_key) : null;
    
    await db.run(
      'UPDATE network_nodes SET node_name = ?, device_type = ?, ip_address = ?, port = ?, is_online = ?, ssh_username = ?, ssh_password = ?, ssh_key = ? WHERE id = ? AND user_id = ?',
      [node_name, device_type, ip_address, port, is_online, ssh_username || null, encPassword, encKey, id, req.user.id]
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

// Check health of all registered nodes from the backend (avoiding CORS and JWT issues)
router.get('/health-check', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const nodes = await db.all('SELECT id, ip_address, port, device_type FROM network_nodes WHERE user_id = ?', [req.user.id]);
    
    const results = {};
    await Promise.all(
      nodes.map(async (node) => {
        let isOnline = false;
        
        // 1. Try health endpoint check
        try {
          const controller = new AbortController();
          const tId = setTimeout(() => controller.abort(), 600);
          const targetUrl = `http://${node.ip_address}:${node.port}/health`;
          const fetchRes = await fetch(targetUrl, { signal: controller.signal });
          clearTimeout(tId);
          if (fetchRes.ok) {
            const data = await fetchRes.json();
            if (data.ok === true || data.status === 'online') {
              isOnline = true;
            }
          }
        } catch (e) {
          // ignore
        }
        
        // 2. Fallback to /api/bridge/health for older configurations or setups
        if (!isOnline && node.device_type !== 'ESP32' && node.device_type !== 'Google Assistant') {
          try {
            const controller = new AbortController();
            const tId = setTimeout(() => controller.abort(), 600);
            const targetUrl = `http://${node.ip_address}:${node.port}/api/bridge/health`;
            const fetchRes = await fetch(targetUrl, { signal: controller.signal });
            clearTimeout(tId);
            if (fetchRes.ok) {
              isOnline = true;
            }
          } catch (e) {
            // ignore
          }
        }
        
        // 3. Fallback to raw TCP port check
        if (!isOnline) {
          isOnline = await checkIpPort(node.ip_address, node.port, 400);
        }
        
        const isOnlineVal = isOnline ? 1 : 0;
        await db.run(
          'UPDATE network_nodes SET is_online = ?, last_seen = CASE WHEN ? = 1 THEN datetime("now") ELSE last_seen END WHERE id = ?',
          [isOnlineVal, isOnlineVal, node.id]
        );
        
        results[node.id] = { status: isOnline ? 'online' : 'offline' };
      })
    );
    
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync network nodes (scans subnet + MDNS Cast and updates network_nodes database table)
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();

    // 1. Ensure default seed nodes exist
    const defaultSeeds = [
      { ip_address: '192.168.1.117', node_name: 'Default ESP32', device_type: 'ESP32', port: 80 },
      { ip_address: '192.168.1.60', node_name: 'Living Room Nest Mini', device_type: 'Google Assistant', port: 8009 },
      { ip_address: '192.168.1.199', node_name: 'Bedroom Nest Mini', device_type: 'Google Assistant', port: 8009 }
    ];

    for (const seed of defaultSeeds) {
      const exist = await db.get(
        'SELECT id FROM network_nodes WHERE user_id = ? AND ip_address = ?',
        [req.user.id, seed.ip_address]
      );
      if (!exist) {
        await db.run(
          'INSERT INTO network_nodes (user_id, node_name, device_type, ip_address, port, is_online) VALUES (?, ?, ?, ?, ?, 0)',
          [req.user.id, seed.node_name, seed.device_type, seed.ip_address, seed.port]
        );
      }
    }

    // 2. Scan network
    const subnet = getLocalSubnet();
    const localIps = getLocalIps();
    const discoveredMap = new Map();

    // 2a. Discover Google Cast devices via MDNS
    try {
      const mDnsSd = require('node-dns-sd');
      const castDevices = await mDnsSd.discover({ name: '_googlecast._tcp.local', timeout: 1500 });
      for (const d of castDevices) {
        if (d && d.address) {
          discoveredMap.set(d.address, {
            node_name: d.friendlyName || d.modelName || 'Google Assistant',
            device_type: 'Google Assistant',
            port: 8009
          });
        }
      }
    } catch (err) {
      console.warn('[Sync Network] MDNS discovery skipped/error:', err.message);
    }

    // 2b. TCP Port Scan on local subnet (skipping gateway/router .1)
    const ipList = [];
    for (let i = 2; i <= 254; i++) {
      const ip = `${subnet}.${i}`;
      if (!localIps.has(ip) && !discoveredMap.has(ip) && ip !== '192.168.1.1') {
        ipList.push(ip);
      }
    }

    // Chunk size 50 to limit parallel sockets
    const batchSize = 50;
    for (let i = 0; i < ipList.length; i += batchSize) {
      const batch = ipList.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ip) => {
          // Check port 80 (ESP32)
          const hasPort80 = await checkIpPort(ip, 80, 250);
          if (hasPort80) {
            // Verify /message endpoint or general availability
            let hasMessageEndpoint = false;
            try {
              const controller = new AbortController();
              const tId = setTimeout(() => controller.abort(), 350);
              const testRes = await fetch(`http://${ip}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: '' }),
                signal: controller.signal
              });
              clearTimeout(tId);
              hasMessageEndpoint = true;
            } catch (e) {}

            if (hasMessageEndpoint) {
              discoveredMap.set(ip, {
                node_name: 'ESP32 Device',
                device_type: 'ESP32',
                port: 80
              });
              return;
            }
          }

          // Check port 3000 (Private AI node)
          const hasPort3000 = await checkIpPort(ip, 3000, 250);
          if (hasPort3000) {
            const info = await getDiscoveryPayload(ip, 3000);
            if (info && info.success) {
              const isRpi = info.device_type && info.device_type.toLowerCase().includes('rpi');
              discoveredMap.set(ip, {
                node_name: info.device_type === 'windows' ? 'Windows Host' : (isRpi ? 'Raspberry Pi' : 'Private AI Node'),
                device_type: info.device_type === 'windows' ? 'Windows' : (isRpi ? 'RPi' : 'Windows'),
                port: 3000
              });
              return;
            }
          }

          // Check port 8009 fallback (Google Cast speaker not found in MDNS)
          const hasPort8009 = await checkIpPort(ip, 8009, 250);
          if (hasPort8009) {
            discoveredMap.set(ip, {
              node_name: 'Google Assistant Speaker',
              device_type: 'Google Assistant',
              port: 8009
            });
          }
        })
      );
    }

    // 3. Update all DB entries and insert newly discovered ones
    const registeredNodes = await db.all('SELECT * FROM network_nodes WHERE user_id = ?', [req.user.id]);
    const registeredIps = new Set(registeredNodes.map(n => n.ip_address));

    // Update existing nodes in database
    for (const node of registeredNodes) {
      let isOnline = 0;
      let finalName = node.node_name;

      if (discoveredMap.has(node.ip_address)) {
        isOnline = 1;
        const disc = discoveredMap.get(node.ip_address);
        if (disc.node_name && disc.node_name !== 'Google Assistant Speaker' && disc.node_name !== 'ESP32 Device') {
          finalName = disc.node_name;
        }
      } else {
        // Double check specifically to avoid false offline status
        const portToCheck = node.port || (node.device_type === 'Google Assistant' ? 8009 : 80);
        const doubleCheck = await checkIpPort(node.ip_address, portToCheck, 300);
        if (doubleCheck) {
          isOnline = 1;
        }
      }

      await db.run(
        'UPDATE network_nodes SET is_online = ?, last_seen = CASE WHEN ? = 1 THEN datetime("now") ELSE last_seen END, node_name = ? WHERE id = ?',
        [isOnline, isOnline, finalName, node.id]
      );
    }

    // Insert newly discovered ones (if not already registered)
    for (const [ip, disc] of discoveredMap.entries()) {
      if (!registeredIps.has(ip) && !localIps.has(ip)) {
        await db.run(
          'INSERT INTO network_nodes (user_id, node_name, device_type, ip_address, port, is_online, last_seen) VALUES (?, ?, ?, ?, ?, 1, datetime("now"))',
          [req.user.id, disc.node_name, disc.device_type, ip, disc.port]
        );
      }
    }

    // 4. Return complete list of nodes from DB
    const finalNodes = await db.all(
      'SELECT id, node_name, device_type, ip_address, port, last_seen, is_online FROM network_nodes WHERE user_id = ? ORDER BY node_name ASC',
      [req.user.id]
    );

    res.json({ success: true, nodes: finalNodes });
  } catch (err) {
    console.error('[Sync Network Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Send a message to a network node / device (ESP32, Google Assistant, etc.)
router.post('/send-message', authenticateToken, async (req, res) => {
  const { ip_address, device_type, message } = req.body;
  
  if (!ip_address || !device_type || !message) {
    return res.status(400).json({ error: 'ip_address, device_type, and message are required' });
  }

  // Enforce 240 character limit locally
  if (message.length > 240) {
    const diff = message.length - 240;
    return res.status(400).json({
      ok: false,
      error: `message exceeds max length 240 by ${diff} characters`
    });
  }

  try {
    if (device_type === 'Google Assistant') {
      const db = await getDb();
      const { handleGoogleHomeTool } = require('../tools/google_home_tool');
      const toolResult = await handleGoogleHomeTool(db, req.user.id, 'speak_text', { text: message, device_ip: ip_address });
      
      try {
        const parsed = JSON.parse(toolResult);
        if (parsed.success) {
          return res.json({ ok: true, message: 'Message spoken successfully' });
        } else {
          return res.status(500).json({ ok: false, error: parsed.error || toolResult });
        }
      } catch (e) {
        return res.json({ ok: true, output: toolResult });
      }
    } else {
      // Treat other devices (ESP32, RPi, Windows) using the handleEsp32Tool message endpoint
      const { handleEsp32Tool } = require('../tools/esp32_tool');
      const toolResult = await handleEsp32Tool(ip_address, null, 'send_message', { message });
      
      if (toolResult.startsWith('Error:')) {
        return res.status(500).json({ ok: false, error: toolResult });
      }

      try {
        const parsed = JSON.parse(toolResult);
        if (parsed.ok !== false && parsed.success !== false) {
          return res.json({ ok: true, data: parsed });
        } else {
          return res.status(500).json({ ok: false, error: parsed.error || toolResult });
        }
      } catch (e) {
        return res.json({ ok: true, output: toolResult });
      }
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Toggle the screen on an ESP32 device: POST http://{ip}:{port}/screen
// with body { "action": "toggle screen" } (handleEsp32Tool builds this).
router.post('/toggle-screen', authenticateToken, async (req, res) => {
  const { ip_address } = req.body;

  if (!ip_address) {
    return res.status(400).json({ error: 'ip_address is required' });
  }

  try {
    const { handleEsp32Tool } = require('../tools/esp32_tool');
    const toolResult = await handleEsp32Tool(ip_address, null, 'toggle_screen', {});

    if (toolResult.startsWith('Error:') || toolResult.startsWith('Failed to communicate')) {
      return res.status(500).json({ ok: false, error: toolResult });
    }

    try {
      const parsed = JSON.parse(toolResult);
      if (parsed.ok !== false && parsed.success !== false) {
        return res.json({ ok: true, data: parsed });
      } else {
        return res.status(500).json({ ok: false, error: parsed.error || toolResult });
      }
    } catch (e) {
      return res.json({ ok: true, output: toolResult });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
