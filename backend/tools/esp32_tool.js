// Use global fetch

/**
 * Sends a command to an ESP32 node via HTTP.
 * This can be used for GPIO writes or reads.
 */
async function handleEsp32Tool(nodeIp, nodePort, action, params = {}, bridgeSecret) {
  const ip = nodeIp || process.env.ESP32_DEFAULT_IP || null;
  if (!ip) {
    return 'Error: No ESP32 IP address provided. Pass an IP address or set the ESP32_DEFAULT_IP environment variable.';
  }
  let portVal = nodePort;
  let devType = '';

  try {
    const { getDb } = require('../db');
    const db = await getDb();
    const nodeRecord = await db.get('SELECT port, device_type FROM network_nodes WHERE ip_address = ?', [ip]);
    if (nodeRecord) {
      devType = nodeRecord.device_type ? nodeRecord.device_type.toLowerCase() : '';
      if (!portVal) {
        if (devType.includes('rpi') || devType.includes('windows') || devType.includes('linux')) {
          portVal = 3000;
        } else {
          portVal = nodeRecord.port;
        }
      }
    }
  } catch (e) {
    // ignore and fallback
  }

  if (!portVal) {
    portVal = (action === 'send_message') ? 80 : 3000;
  }

  try {
    let url;
    let bodyData;

    const headers = {};
    if (bridgeSecret) {
      headers['Authorization'] = `Bearer ${bridgeSecret}`;
    }

    let bodyPayload;
    if (action === 'send_message') {
      url = `http://${ip}:${portVal}/message`;
      headers['Content-Type'] = 'application/json';
      bodyPayload = JSON.stringify({ message: params.message });
    } else {
      url = `http://${ip}:${portVal}/api/gpio/${action}`;
      headers['Content-Type'] = 'application/json';
      bodyPayload = JSON.stringify(params);
    }

    let data;
    if (action === 'send_message') {
      const http = require('http');
      const res = await new Promise((resolve, reject) => {
        let targetIp = ip;
        let targetPort = portVal;
        if (ip.includes(':')) {
          const parts = ip.split(':');
          targetIp = parts[0];
          targetPort = parseInt(parts[1], 10);
        }

        const options = {
          hostname: targetIp,
          port: targetPort,
          path: '/message',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyPayload),
            ...headers
          }
        };

        const req = http.request(options, (httpRes) => {
          let responseBody = '';
          httpRes.on('data', (chunk) => {
            responseBody += chunk;
          });
          httpRes.on('end', () => {
            resolve({
              ok: httpRes.statusCode >= 200 && httpRes.statusCode < 300,
              status: httpRes.statusCode,
              body: responseBody
            });
          });
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.write(bodyPayload);
        req.end();
      });

      try {
        data = JSON.parse(res.body);
      } catch (e) {
        // Response was not JSON
      }

      if (!res.ok) {
        if (data && data.error) {
          throw new Error(data.error);
        }
        throw new Error(`ESP32 responded with status: ${res.status}`);
      }
    } else {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyPayload
      });

      try {
        data = await res.json();
      } catch (e) {
        // Response was not JSON
      }

      if (!res.ok) {
        if (data && data.error) {
          throw new Error(data.error);
        }
        throw new Error(`ESP32 responded with status: ${res.status}`);
      }
    }

    return JSON.stringify(data || { success: true });
  } catch (err) {
    const isEsp32 = !devType || devType.includes('esp32');
    const deviceName = isEsp32 ? 'ESP32' : 'device';
    if (action === 'send_message') {
      return `Error: Failed to communicate with ${deviceName} at ${ip}. The /message endpoint is unreachable. Please verify if the device is online and try again with the updated/corrected IP address. (Details: ${err.message})`;
    }
    return `Failed to communicate with ${deviceName} at ${ip}: ${err.message}`;
  }
}

module.exports = {
  handleEsp32Tool
};
