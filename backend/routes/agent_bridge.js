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
    const userExists = await db.get('SELECT id FROM users WHERE id = ?', [decoded.id]);
    if (userExists) {
      req.user = decoded;
      return next();
    }
  } catch (err) {
    // Not a valid JWT, continue to bridge secret verification
  }

  // 2. Check process.env.BRIDGE_SECRET
  if (process.env.BRIDGE_SECRET && token === process.env.BRIDGE_SECRET) {
    req.isBridge = true;
    const firstUser = await db.get('SELECT id FROM users ORDER BY id LIMIT 1');
    req.user = { id: firstUser ? firstUser.id : 1 };
    return next();
  }

  // 3. Check if the token matches the remote node's own local_key in user_settings
  const settings = await db.get('SELECT local_key FROM user_settings LIMIT 1');
  if (settings && settings.local_key) {
    const { decrypt } = require('../utils/crypto');
    let decryptedKey = '';
    try {
      decryptedKey = decrypt(settings.local_key);
    } catch (e) {
      decryptedKey = settings.local_key;
    }
    if (decryptedKey && token === decryptedKey) {
      req.isBridge = true;
      const firstUser = await db.get('SELECT id FROM users ORDER BY id LIMIT 1');
      req.user = { id: firstUser ? firstUser.id : 1 };
      return next();
    }
  }

  // 4. Check if the token matches any registered node's bridge_secret in network_nodes
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

// GET /api/bridge/health - Health check diagnostics (Rule 5 & 6)
router.get('/health', async (req, res) => {
  const diagnostics = {
    status: 'online',
    timestamp: new Date().toISOString(),
    dependencies: {
      database: 'offline',
      llm_provider: 'offline',
      mqtt_broker: 'offline'
    }
  };

  try {
    const db = await getDb();
    const dbCheck = await db.get('SELECT 1');
    if (dbCheck) diagnostics.dependencies.database = 'stable';
  } catch (err) {
    diagnostics.status = 'degraded';
    diagnostics.dependencies.database = `error: ${err.message}`;
  }

  try {
    const db = await getDb();
    const settings = await db.get('SELECT local_url, provider FROM user_settings LIMIT 1');
    
    if (settings && settings.provider === 'local') {
      const targetUrl = settings.local_url || 'http://192.168.1.42:1234/v1';
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000); // 2s timeout
      
      const llmRes = await fetch(`${new URL(targetUrl).origin}/v1/models`, { signal: controller.signal });
      clearTimeout(id);
      if (llmRes.ok) diagnostics.dependencies.llm_provider = 'stable';
    } else {
      diagnostics.dependencies.llm_provider = 'configured-external';
    }
  } catch (err) {
    diagnostics.status = 'degraded';
    diagnostics.dependencies.llm_provider = `unreachable: ${err.message}`;
  }

  try {
    const mqttService = require('../services/mqtt_service');
    if (mqttService.client && mqttService.connected) {
      diagnostics.dependencies.mqtt_broker = 'stable';
    } else {
      diagnostics.dependencies.mqtt_broker = 'disconnected';
    }
  } catch (err) {
    diagnostics.dependencies.mqtt_broker = 'not_configured';
  }

  const statusCode = diagnostics.status === 'online' ? 200 : 207;
  return res.status(statusCode).json(diagnostics);
});

// POST /api/bridge/execute - Execute command remotely on this node
router.post('/execute', authenticateBridge, async (req, res) => {
  const { action, params = {} } = req.body;
  if (!action) return res.status(400).json({ error: 'action is required' });

  try {
    const db = await getDb();

    // SECURITY CHECK: If this node is the Parent Node (Main Host), reject all remote network incoming commands immediately
    const settings = await db.get('SELECT is_main_host FROM user_settings LIMIT 1');
    const ALLOWED_SYSTEM_INFO_ACTIONS = [
      'system_info', 
      'get_specifications', 
      'get_power', 
      'get_temperature', 
      'get_network_info', 
      'get_process_list', 
      'get_service_status', 
      'get_journal_logs', 
      'security_scan',
      'get_capabilities'
    ];

    if (settings && settings.is_main_host === 1) {
      const blockedActions = ['update_node', 'apply_update', 'install_tool', 'write_file'];
      if (blockedActions.includes(action) && req.isBridge) {
        console.warn(`[Security Alert] Blocked cross-node mutation request for action: ${action}`);
        return res.status(403).json({ error: 'Access Denied: Peripheral node endpoints are unauthorized to mutate files or execute commands on the Main Host machine.' });
      }
      
      if (!ALLOWED_SYSTEM_INFO_ACTIONS.includes(action) && req.isBridge) {
        console.warn(`[Security Alert] Blocked incoming bridge command from remote node: target node is Main Host.`);
        return res.status(403).json({ error: 'Access denied: Commands cannot be routed to the Parent Node (machine running the LLM).' });
      }
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
    } else if (action === 'update_node' || action === 'apply_update') {
      const safeUpdateService = require('../services/safe_update_service');
      safeUpdateService.runUpdatePipeline().then((result) => {
        console.log(`[Safe Update] Pipeline finished: ${JSON.stringify(result)}`);
      }).catch((err) => {
        console.error(`[Safe Update] Pipeline failed: ${err.message}`);
      });
      output = 'Safe self-update pipeline initiated in the background. The node will fetch, pull to staging, run validation tests, apply changes, and hot-reload.';
    } else if (action === 'install_tool') {
      const toolManager = require('../services/tool_manager');
      const manifest = await toolManager.installTool(params.toolName);
      output = `Successfully installed tool "${params.toolName}" (v${manifest.version}) on this node.`;
    } else if (action === 'uninstall_tool') {
      const toolManager = require('../services/tool_manager');
      await toolManager.uninstallTool(params.toolName);
      output = `Successfully uninstalled tool "${params.toolName}" from this node.`;
    } else if (action === 'check_updates') {
      const safeUpdateService = require('../services/safe_update_service');
      const updateInfo = await safeUpdateService.checkForUpdates();
      output = JSON.stringify(updateInfo);
    } else if ([
      'get_specifications', 
      'get_power', 
      'get_temperature', 
      'get_network_info', 
      'get_process_list', 
      'get_service_status', 
      'get_journal_logs', 
      'restart_service',
      'security_scan', 
      'get_capabilities'
    ].includes(action)) {
      const { handleHostMachineTool } = require('../tools/host_machine_tool');
      output = await handleHostMachineTool(action, params, req.user.id);
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
