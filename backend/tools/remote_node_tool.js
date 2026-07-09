const { getDb } = require('../db');
const mqttService = require('../services/mqtt_service');

async function handleRemoteNodeTool(action, params = {}, options = {}) {
  if (action !== 'get_system_info') {
    return `Error: Unknown action "${action}". Only "get_system_info" is supported.`;
  }

  const { nodeId } = params;
  if (!nodeId) {
    return 'Error: "nodeId" parameter is required.';
  }

  try {
    const db = await getDb();
    
    // Check if target node exists (support both ID and name lookup)
    let node = null;
    if (!isNaN(nodeId) && Number.isInteger(Number(nodeId))) {
      node = await db.get('SELECT * FROM network_nodes WHERE id = ? AND user_id = ?', [Number(nodeId), options.userId]);
    }
    if (!node) {
      node = await db.get('SELECT * FROM network_nodes WHERE LOWER(node_name) = ? AND user_id = ?', [String(nodeId).toLowerCase(), options.userId]);
    }
    if (!node) {
      // Flexible lookup matching name/device type
      const cleanNodeId = String(nodeId).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanNodeId) {
        const allNodes = await db.all('SELECT * FROM network_nodes WHERE user_id = ?', [options.userId]);
        node = allNodes.find(n => {
          const cleanName = n.node_name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const cleanType = (n.device_type || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanName === cleanNodeId || cleanType === cleanNodeId || cleanName.includes(cleanNodeId);
        });
      }
    }

    if (!node) {
      return `Error: Node with identifier "${nodeId}" not found in registered network nodes.`;
    }

    // If target node is the Main Host, retrieve local telemetry directly
    if (node.is_main_host === 1 || node.node_name.toLowerCase() === 'parent') {
      const os = require('os');
      const { handleHostMachineTool } = require('./host_machine_tool');
      const tempReport = await handleHostMachineTool('get_temperature');
      const powerReport = await handleHostMachineTool('get_power');
      
      return `### Main Host System Telemetry:
- **OS**: ${os.type()} ${os.release()} (${os.arch()})
- **Timezone**: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
- **Local Time**: ${new Date().toLocaleString()}
- **CPU Temperature**: ${tempReport}
- **Power System**: ${powerReport}`;
    }

    // Determine MQTT client ID of the remote node
    let remoteClientId = node.mqtt_topic || `node_${node.id}`;
    if (node.device_type === 'esp32-wroom') {
      if (remoteClientId.startsWith('nodes/')) {
        const parts = remoteClientId.split('/');
        remoteClientId = parts[1];
      }
    }

    remoteClientId = remoteClientId.replace(/^nodes\//, '').replace(/\/.*$/, '');

    console.log(`[Remote Node Tool] Querying system info from MQTT Node Client: "${remoteClientId}"`);

    // Run the correlated MQTT request
    try {
      const result = await mqttService.publishAndAwaitResponse(remoteClientId, 'get_system_info', 8000);
      if (result && result.status === 'success' && result.data) {
        const d = result.data;
        
        let tempStr = 'Unavailable';
        if (typeof d.temperature === 'number') {
          tempStr = `${d.temperature.toFixed(1)} °C`;
        } else if (d.temperature && d.temperature.average && typeof d.temperature.average.celsius === 'number') {
          tempStr = `${d.temperature.average.celsius} °C (${d.temperature.average.fahrenheit} °F)`;
        } else if (typeof d.temperature === 'string') {
          tempStr = d.temperature;
        }

        let powerStr = 'Unavailable';
        if (d.power && typeof d.power === 'object') {
          powerStr = `Voltage: ${d.power.voltage_v}V | Power: ${d.power.power_w}W | Battery: ${d.power.battery_percent}%`;
        } else if (typeof d.power === 'string') {
          powerStr = d.power;
        }

        return `### Remote Node Telemetry: "${node.node_name}" (${node.device_type.toUpperCase()})
- **OS**: ${d.os || 'Unknown'}
- **IP Address**: ${d.ip_address || 'Unknown'}
- **Timezone**: ${d.timezone || 'UTC'}
- **Local Time**: ${d.timestamp ? new Date(d.timestamp).toLocaleString() : 'Unknown'}
- **CPU Temperature**: ${tempStr}
- **Power System**: ${powerStr}`;
      } else {
        return `Error: Received unexpected or malformed response from node "${node.node_name}".`;
      }
    } catch (err) {
      console.error(`[Remote Node Tool] MQTT Request failed for "${remoteClientId}":`, err.message);
      return `Error: Node "${node.node_name}" is offline, unreachable, or timed out. (${err.message})`;
    }

  } catch (err) {
    return `Error processing remote node request: ${err.message}`;
  }
}

module.exports = { handleRemoteNodeTool };
