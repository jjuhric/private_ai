const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const jwt = require('jsonwebtoken');

// Middleware to authenticate either a standard JWT token OR matching bridge secret
async function authenticateBridge(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header is required' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token is required' });
  }

  const db = await getDb();

  // 1. Try to verify as standard JWT
  const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_private_ai_assistant_2026';
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    // Not a valid JWT, continue to bridge secret verification
  }

  // 2. Check if the token matches any registered node's bridge_secret in network_nodes
  const node = await db.get('SELECT * FROM network_nodes WHERE bridge_secret = ?', [token]);
  if (node) {
    req.isBridge = true;
    req.bridgeNode = node;
    // Set mock req.user for queries if needed
    req.user = { id: node.user_id };
    return next();
  }

  return res.status(403).json({ error: 'Forbidden: Invalid token or bridge secret' });
}

// POST /api/bridge/execute - Execute command remotely on this node
router.post('/execute', authenticateBridge, async (req, res) => {
  const { action, params = {} } = req.body;
  if (!action) return res.status(400).json({ error: 'action is required' });

  try {
    const db = await getDb();

    // SECURITY CHECK: If this node is the Parent Node (Main Host), reject all remote network incoming commands immediately
    const settings = await db.get('SELECT is_main_host FROM user_settings LIMIT 1');
    if (settings && settings.is_main_host === 1 && req.isBridge) {
      console.warn(`[Security Alert] Blocked incoming bridge command from remote node: target node is Main Host.`);
      return res.status(403).json({ error: 'Access denied: Commands cannot be routed to the Parent Node (machine running the LLM).' });
    }

    let output = '';

    if (action === 'system_info') {
      const os = require('os');
      const { handleHostMachineTool } = require('../tools/host_machine_tool');
      const tempReport = await handleHostMachineTool('get_temperature');
      const powerReport = await handleHostMachineTool('get_power');
      const netReport = await handleHostMachineTool('get_network_info');
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      
      output = `System telemetry details:
- OS: ${os.type()} ${os.release()} (${os.arch()})
- CPU Model: ${os.cpus()[0]?.model || 'Unknown'}
- CPU Cores: ${os.cpus().length}
- Load Average: ${os.loadavg().map(v => v.toFixed(2)).join(', ')}
- Memory Total: ${(totalMem / 1024 / 1024).toFixed(0)} MB
- Memory Free: ${(freeMem / 1024 / 1024).toFixed(0)} MB
- Uptime: ${(os.uptime() / 3600).toFixed(1)} hours
- Temperature: ${tempReport}
- Power Status: ${powerReport}
- Network: ${netReport}`;
    } else if (action === 'run_command') {
      const { handleCoderTool } = require('../tools/coder_tools');
      output = await handleCoderTool('execute_command', {
        command: params.command,
        sudo_password: params.sudo_password,
        safety_analysis: { risk_level: 'low', reason: 'Remote executed command', potential_harm: 'None', recommendation: 'safe_to_approve' }
      }, {
        userId: req.user.id
        // We omit onCommandApprovalRequired so it executes directly without asking the local console (since approval was done on caller node)
      });
    } else if (action === 'write_file') {
      const { handleCoderTool } = require('../tools/coder_tools');
      output = await handleCoderTool('write_file', { filePath: params.filePath, content: params.content });
    } else if (action === 'read_file') {
      const { handleCoderTool } = require('../tools/coder_tools');
      output = await handleCoderTool('read_file', { filePath: params.filePath });
    } else {
      return res.status(400).json({ error: `Unknown action "${action}"` });
    }

    res.json({
      success: true,
      message: `Action "${action}" executed successfully`,
      output
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
