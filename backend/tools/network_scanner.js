const os = require('os');
const net = require('net');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Helper to get local subnet
function getLocalSubnet() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const netObj of interfaces[name]) {
      if (netObj.family === 'IPv4' && !netObj.internal) {
        const parts = netObj.address.split('.');
        if (parts.length === 4) {
          return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
      }
    }
  }
  return '192.168.1';
}

// Get all local IPv4 addresses of this machine, so the scanner doesn't discover and
// register itself as a remote field node.
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

// Fetch all resolved ARP devices
async function getArpDevices() {
  const devices = [];
  try {
    const { stdout } = await execPromise('arp -a');
    const lines = stdout.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const ipMatch = trimmed.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (ipMatch) {
        const ip = ipMatch[1];
        if (ip.endsWith('.255') || ip.startsWith('224.') || ip.startsWith('239.') || ip === '255.255.255.255') {
          continue;
        }
        
        let mac = 'Unknown';
        const macMatch = trimmed.match(/([0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2})/);
        if (macMatch) {
          mac = macMatch[1].replace(/-/g, ':').toLowerCase();
        }
        devices.push({ ip, mac });
      }
    }
  } catch (e) {
    console.error('[Network Scanner] ARP fetch error:', e.message);
  }
  return devices;
}

// Check ports in parallel on a given IP
function checkIpPorts(ip, ports = [80, 22, 3000, 8009, 443, 445], timeout = 200) {
  return new Promise(async (resolve) => {
    const activePorts = [];
    await Promise.all(
      ports.map(port => {
        return new Promise((portResolve) => {
          const socket = new net.Socket();
          let isDone = false;
          socket.setTimeout(timeout);
          socket.on('connect', () => {
            activePorts.push(port);
            socket.destroy();
            isDone = true;
            portResolve();
          });
          const handleErr = () => {
            socket.destroy();
            if (!isDone) {
              isDone = true;
              portResolve();
            }
          };
          socket.on('error', handleErr);
          socket.on('timeout', handleErr);
          socket.connect(port, ip);
        });
      })
    );
    resolve(activePorts);
  });
}

/**
 * Executes a network scan on the specified subnet.
 */
async function handleNetworkScanner(action, params = {}) {
  if (action !== 'scan_network' && action !== 'scan_subnet') {
    return `Error: Unknown action "${action}". Supported actions are "scan_network" and "scan_subnet".`;
  }

  // 1. Resolve subnet target
  let targetInput = params.subnet || params.ip || params.ip_address || params.ip_range || '';
  let subnet = '';
  if (targetInput) {
    const match = targetInput.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (match) {
      subnet = match[1];
    }
  }
  if (!subnet) {
    subnet = getLocalSubnet();
  }

  console.log(`[Network Scanner] Initiating network scan on subnet: ${subnet}.0/24...`);

  // 2. Discover Google Cast devices via MDNS
  const castDevicesMap = new Map();
  try {
    const mDnsSd = require('node-dns-sd');
    const castDevices = await mDnsSd.discover({ name: '_googlecast._tcp.local', timeout: 1500 });
    for (const d of castDevices) {
      if (d && d.address && d.address.startsWith(subnet)) {
        castDevicesMap.set(d.address, d.friendlyName || d.modelName || 'Google Nest/Cast Device');
      }
    }
  } catch (err) {
    console.warn('[Network Scanner] MDNS discovery skipped/error:', err.message);
  }

  // 3. Retrieve ARP cache devices
  const arpDevices = await getArpDevices();
  const arpMap = new Map();
  for (const d of arpDevices) {
    if (d.ip.startsWith(subnet)) {
      arpMap.set(d.ip, d.mac);
    }
  }

  // 4. Perform TCP Subnet Sweep (skip the gateway and this machine's own addresses)
  const localIps = getLocalIps();
  const ipList = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    if (ip === `${subnet}.1` || localIps.has(ip)) continue;
    ipList.push(ip);
  }

  const activeDevices = [];
  const batchSize = 50;

  for (let i = 0; i < ipList.length; i += batchSize) {
    const batch = ipList.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (ip) => {
        // Probe ports
        const activePorts = await checkIpPorts(ip);
        const isCast = castDevicesMap.has(ip);
        const inArp = arpMap.has(ip);

        if (activePorts.length > 0 || isCast || inArp) {
          let name = 'Unknown Device';
          let deviceType = 'Generic Node';

          if (isCast) {
            name = castDevicesMap.get(ip);
            deviceType = 'Google Assistant';
          } else if (activePorts.includes(3000)) {
            name = 'Private AI Assistant Host';
            deviceType = 'Windows/Linux Node';
          } else if (activePorts.includes(80)) {
            // Check if it's an ESP32
            let isEsp = false;
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
              isEsp = testRes.ok;
            } catch (e) {}

            if (isEsp) {
              name = 'ESP32 IoT Node';
              deviceType = 'ESP32';
            } else {
              name = 'Web Server / Router';
              deviceType = 'HTTP Host';
            }
          } else if (activePorts.includes(22)) {
            name = 'SSH Server';
            deviceType = 'Linux Node/RPi';
          }

          activeDevices.push({
            ip,
            mac: arpMap.get(ip) || 'Unknown',
            name,
            deviceType,
            ports: activePorts.join(', ') || 'None Detected'
          });
        }
      })
    );
  }

  // 4b. Sync active devices to DB
  try {
    const { getDb } = require('../db');
    const db = await getDb();
    for (const dev of activeDevices) {
      const isUnidentified = dev.deviceType === 'Generic Node';
      const portVal = dev.ports.includes('8009') ? 8009 : (dev.ports.includes('3000') ? 3000 : 80);
      const exist = await db.get(
        'SELECT id, device_type FROM network_nodes WHERE ip_address = ?',
        [dev.ip]
      );
      if (!exist) {
        // Don't clutter the Field Nodes list with devices we can't actually identify or act on
        // (e.g. phones, printers, or other LAN devices that merely have some port open).
        if (isUnidentified) continue;
        await db.run(
          'INSERT INTO network_nodes (user_id, node_name, device_type, ip_address, port, is_online, last_seen) VALUES (1, ?, ?, ?, ?, 1, datetime("now"))',
          [dev.name, dev.deviceType, dev.ip, portVal]
        );
      } else if (isUnidentified) {
        // Don't downgrade a previously-identified device (e.g. a Google Nest speaker) to
        // "Unknown Device" just because this pass couldn't re-confirm its signature -
        // mDNS cast discovery in particular is timing-sensitive and can miss a device.
        await db.run(
          'UPDATE network_nodes SET is_online = 1, last_seen = datetime("now") WHERE id = ?',
          [exist.id]
        );
      } else {
        const finalDeviceType = exist.device_type === 'google_home' ? 'google_home' : dev.deviceType;
        await db.run(
          'UPDATE network_nodes SET is_online = 1, last_seen = datetime("now"), node_name = ?, device_type = ? WHERE id = ?',
          [dev.name, finalDeviceType, exist.id]
        );
      }
    }
  } catch (dbErr) {
    console.error('[Network Scanner] DB Sync failed:', dbErr.message);
  }

  // 5. Generate Markdown Report
  if (activeDevices.length === 0) {
    return `### 🔍 Network Scan Report: \`${subnet}.0/24\`\nNo active devices were discovered on the network.`;
  }

  // Sort by IP numerically
  activeDevices.sort((a, b) => {
    const partA = parseInt(a.ip.split('.').pop());
    const partB = parseInt(b.ip.split('.').pop());
    return partA - partB;
  });

  let report = `### 🔍 Network Scan Report: \`${subnet}.0/24\`\n\n`;
  report += `Discovered **${activeDevices.length}** active device(s):\n\n`;
  report += `| IP Address | MAC Address | Device Friendly Name | Device Type | Active Ports |\n`;
  report += `| :--- | :--- | :--- | :--- | :--- |\n`;
  for (const dev of activeDevices) {
    report += `| \`${dev.ip}\` | \`${dev.mac}\` | ${dev.name} | **${dev.deviceType}** | \`${dev.ports}\` |\n`;
  }

  return report;
}

module.exports = { handleNetworkScanner };
