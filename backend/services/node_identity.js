const os = require('os');
const { getDb } = require('../db');
const toolManager = require('./tool_manager');
const logger = require('../utils/logger');

class NodeIdentity {
  constructor() {
    this.profile = null;
  }

  async getIdentity() {
    if (this.profile) return this.profile;
    
    try {
      const db = await getDb();
      
      // Determine node name and main host status from database
      const settings = await db.get('SELECT device_type, is_main_host FROM user_settings LIMIT 1');
      const nodeId = process.env.MQTT_NODE_ID || (settings ? `${settings.device_type}-${settings.is_main_host ? 'main' : 'field'}` : 'node-unknown');
      const isMainHost = settings ? settings.is_main_host === 1 : false;

      // Get installed dynamic tools list
      const installedTools = await toolManager.getInstalledTools();
      const toolNames = installedTools.map(t => t.tool_name);

      // Probe system specs
      const cpus = os.cpus();
      const totalMemoryMB = Math.round(os.totalmem() / 1024 / 1024);

      this.profile = {
        nodeId,
        isMainHost,
        os: os.type(),
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpuModel: cpus[0] ? cpus[0].model : 'Unknown',
        cores: cpus.length,
        totalMemoryMB,
        nodeVersion: process.version,
        installedTools: toolNames,
        timestamp: new Date().toISOString()
      };
      
      return this.profile;
    } catch (err) {
      logger.error(`[Node Identity] Failed to get identity: ${err.message}`);
      // Fallback if DB not ready
      return {
        nodeId: process.env.MQTT_NODE_ID || 'node-fallback',
        os: os.type(),
        arch: os.arch(),
        nodeVersion: process.version
      };
    }
  }

  clearCache() {
    this.profile = null;
  }
}

module.exports = new NodeIdentity();
