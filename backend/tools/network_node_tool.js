const { getDb } = require('../db');

async function handleListNetworkNodes(userId) {
  try {
    const db = await getDb();
    const nodes = await db.all(
      'SELECT id, node_name, device_type, ip_address, port, is_online FROM network_nodes WHERE user_id = ?',
      [userId]
    );
    if (nodes.length === 0) {
      return 'No remote network nodes registered. Please register them in Settings -> Nodes first.';
    }
    const details = nodes.map(n => 
      `- [ID: ${n.id}] Name: "${n.node_name}" (${n.device_type}) | Address: http://${n.ip_address}:${n.port} | Status: ${n.is_online ? 'ONLINE' : 'OFFLINE'}`
    );
    return `### Registered Network Nodes:\n${details.join('\n')}`;
  } catch (err) {
    return `Error listing network nodes: ${err.message}`;
  }
}

async function handleRemoteNodeBridge(params, options = {}) {
  const { nodeId, action, actionParams = {} } = params;
  if (!nodeId) return 'Error: "nodeId" is required.';
  if (!action) return 'Error: "action" is required.';

  try {
    const db = await getDb();
    
    // Check if target node exists
    const node = await db.get('SELECT * FROM network_nodes WHERE id = ? AND user_id = ?', [nodeId, options.userId]);
    if (!node) {
      return `Error: Node with ID ${nodeId} not found in database.`;
    }

    // Check if the target node is the Parent/Main Host
    // In our security model, nothing can route commands to the Parent Node.
    if ((node.is_main_host === 1 || node.node_name.toLowerCase() === 'parent') && action !== 'system_info') {
      return 'Error: Access denied. Commands cannot be routed to the Parent Node (machine running the LLM).';
    }

    const cmdParams = { ...actionParams };
    
    // If the action is a shell command requiring sudo, check for sudo password approval locally
    if (action === 'run_command' && cmdParams.command && cmdParams.command.includes('sudo') && !cmdParams.sudo_password) {
      if (options.onCommandApprovalRequired) {
        const commandId = 'cmd_' + Math.random().toString(36).substring(2, 15);
        options.onCommandApprovalRequired({
          commandId,
          command: cmdParams.command,
          safety_analysis: {
            risk_level: 'medium',
            reason: `Execute administrative command on remote node "${node.node_name}"`,
            potential_harm: 'Unauthorized system modifications on remote node',
            recommendation: 'review_carefully'
          }
        });

        const { registerPendingCommand } = require('../utils/commandApproval');
        const approvalResult = await registerPendingCommand(commandId, cmdParams.command, options.userId);
        if (!approvalResult.approved) {
          return `Command execution rejected by user.`;
        }
        cmdParams.sudo_password = approvalResult.password;
      }
    }

    // Resolve authentication token: 
    // 1. Registered node bridge_secret
    // 2. Local environment BRIDGE_SECRET
    // 3. Local decrypted local_key
    let tokenToSend = node.bridge_secret;
    if (!tokenToSend) {
      tokenToSend = process.env.BRIDGE_SECRET;
    }
    if (!tokenToSend) {
      const settings = await db.get('SELECT local_key FROM user_settings LIMIT 1');
      if (settings && settings.local_key) {
        const { decrypt } = require('../utils/crypto');
        try {
          tokenToSend = decrypt(settings.local_key);
        } catch (e) {
          tokenToSend = settings.local_key;
        }
      }
    }

    // Call the remote node API
    const targetUrl = `http://${node.ip_address}:${node.port || 3000}/api/bridge/execute`;
    console.log(`[Network Bridge] Routing action "${action}" to Node "${node.node_name}" at ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenToSend || ''}`
      },
      body: JSON.stringify({
        action,
        params: cmdParams
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return `Error: Remote execution failed with status ${response.status}: ${errorText}`;
    }

    const data = await response.json();
    return `### Execution Result from Node "${node.node_name}":\n${data.output || data.message || JSON.stringify(data, null, 2)}`;
  } catch (err) {
    return `Error routing command to remote node: ${err.message}`;
  }
}

async function handleNetworkNodeTool(action, params = {}, options = {}) {
  switch (action) {
    case 'list_network_nodes':
      return handleListNetworkNodes(options.userId);
    case 'remote_node_bridge':
      return handleRemoteNodeBridge(params, options);
    default:
      return `Error: Unknown network node tool action "${action}".`;
  }
}

module.exports = { handleNetworkNodeTool };
