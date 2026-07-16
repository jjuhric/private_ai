const dns = require('node-dns-sd');
const logger = require('../utils/logger');
const { getDb } = require('../db');

let isDiscovering = false;

async function discoverGoogleCastDevices() {
  if (isDiscovering) return;
  isDiscovering = true;
  
  try {
    logger.info('[Nest Discovery] Scanning for Google Cast / Nest devices on the network...');
    // Query mDNS for _googlecast._tcp.local
    const devices = await dns.discover({
      name: '_googlecast._tcp.local'
    });
    
    if (!devices || devices.length === 0) {
      logger.info('[Nest Discovery] No Google Cast devices found on this network scan.');
      isDiscovering = false;
      return;
    }
    
    logger.info(`[Nest Discovery] Found ${devices.length} Cast device(s). Logging to database...`);
    
    const db = await getDb();
    
    for (const device of devices) {
      // The device typically has an address and a fqdn or packet with more info.
      // E.g., device.address
      const ipAddress = device.address;
      
      // Node DNS SD returns packet and other info. We'll extract a friendly name if possible.
      let deviceName = 'Google Cast Device';
      // Attempt to find friendly name in TXT records if available
      if (device.packet && device.packet.additionals) {
        for (const record of device.packet.additionals) {
          if (record.type === 'TXT' && record.rdata) {
            // TXT records are key=value pairs, often containing "fn=Friendly Name"
            for (const item of Object.keys(record.rdata)) {
               if (item.startsWith('fn=')) {
                 deviceName = item.substring(3);
                 break;
               } else if (item === 'fn' && record.rdata['fn']) {
                 deviceName = record.rdata['fn'];
                 break;
               }
            }
          }
        }
      }

      // Check if node already exists by name
      const existingNode = await db.get('SELECT id FROM network_nodes WHERE node_name = ? AND user_id = 1', [deviceName]);
      
      if (existingNode) {
        await db.run(`
          UPDATE network_nodes SET 
            is_online = 1, 
            last_seen = CURRENT_TIMESTAMP, 
            ip_address = ?,
            port = 8009,
            device_type = 'google_home'
          WHERE id = ?
        `, [ipAddress, existingNode.id]);
      } else {
        await db.run(`
          INSERT INTO network_nodes (user_id, node_name, device_type, ip_address, port, is_online, last_seen, os_type)
          VALUES (1, ?, 'google_home', ?, 8009, 1, CURRENT_TIMESTAMP, 'Cast OS')
        `, [deviceName, ipAddress]);
      }
    }
    
  } catch (err) {
    logger.error(`[Nest Discovery] Error during mDNS scan: ${err.message}`);
  } finally {
    isDiscovering = false;
  }
}

function startGoogleNestDiscovery() {
  // Run on startup
  setTimeout(() => {
    discoverGoogleCastDevices();
  }, 15000); // Wait 15s after startup

  // And every 15 minutes
  setInterval(() => {
    discoverGoogleCastDevices();
  }, 15 * 60 * 1000);
}

module.exports = { startGoogleNestDiscovery, discoverGoogleCastDevices };
