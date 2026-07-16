const fs = require('fs');
const path = require('path');
const os = require('os');
const mqtt = require('mqtt');
const dotenv = require('dotenv');
const macaddress = require('macaddress');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Load env variables
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const isHost = process.env.IS_HOST !== 'false';

// Helper to write/update key-value pair in .env
function writeEnvVar(key, val) {
  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    const linePattern = new RegExp(`^${key}=.*`, 'm');
    if (envContent.match(linePattern)) {
      envContent = envContent.replace(linePattern, `${key}=${val}`);
    } else {
      envContent += `\n${key}=${val}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (err) {
    console.error('Failed to write to .env:', err);
  }
}

// 1. Resolve or Generate NODE_ID
async function getOrInitNodeId() {
  let nodeId = process.env.NODE_ID || process.env.MQTT_NODE_ID;
  if (nodeId && nodeId !== 'windows-main' && nodeId !== 'field-node') {
    return nodeId;
  }

  // Try retrieving primary MAC address
  try {
    const mac = await new Promise((resolve, reject) => {
      macaddress.one((err, addr) => {
        if (err) reject(err);
        else resolve(addr);
      });
    });
    nodeId = 'node_' + mac.toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch (err) {
    nodeId = 'node_' + Math.random().toString(36).substring(2, 10);
  }

  writeEnvVar('NODE_ID', nodeId);
  process.env.NODE_ID = nodeId;
  return nodeId;
}

// 2. Hardware: Temperature Sensor (adapted from backend/tools/temp_tool.js)
async function getCpuTemp() {
  try {
    // Try vcgencmd (Raspberry Pi specific)
    try {
      const { stdout } = await execPromise('vcgencmd measure_temp');
      const match = stdout.match(/temp=([\d.]+)/);
      if (match && match[1]) {
        return parseFloat(match[1]);
      }
    } catch (err) {}

    // Try sysfs thermal zone (standard Linux)
    if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
      const content = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
      const tempMilli = parseInt(content.trim(), 10);
      if (!isNaN(tempMilli)) {
        return tempMilli / 1000;
      }
    }
  } catch (err) {}
  
  return 'Unavailable';
}

// 3. Hardware: INA219 Power Sensor (adapted from backend/tools/ina219_tool.js)
async function getPowerReading() {
  try {
    const i2c = require('i2c-bus');
    // Open I2C bus 1
    const bus = i2c.openSync(1);
    
    // Address 0x41 for INA219
    const addr = 0x41;
    const REG_BUSVOLTAGE = 0x02;
    const REG_POWER = 0x03;
    const REG_CALIBRATION = 0x05;
    
    // Write calibration configuration (16V 5A mode)
    const calBuffer = Buffer.from([(26868 & 0xFF00) >> 8, 26868 & 0xFF]);
    bus.writeI2cBlockSync(addr, REG_CALIBRATION, 2, calBuffer);
    
    // Read Bus Voltage
    const voltBuf = Buffer.alloc(2);
    bus.readI2cBlockSync(addr, REG_BUSVOLTAGE, 2, voltBuf);
    const rawVolt = (voltBuf[0] * 256) + voltBuf[1];
    const voltage = (rawVolt >> 3) * 0.004;

    // Read Power
    const powerBuf = Buffer.alloc(2);
    bus.readI2cBlockSync(addr, REG_POWER, 2, powerBuf);
    const rawPower = (powerBuf[0] * 256) + powerBuf[1];
    const power = rawPower * 0.003048;

    bus.closeSync();

    let batteryPercent = ((voltage - 9) / 3.6) * 100;
    if (batteryPercent > 100) batteryPercent = 100;
    if (batteryPercent < 0) batteryPercent = 0;

    return {
      voltage_v: Number(voltage.toFixed(3)),
      power_w: Number(power.toFixed(3)),
      battery_percent: Number(batteryPercent.toFixed(1))
    };
  } catch (err) {
    return 'Unavailable';
  }
}

// Get primary external IPv4 IP
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

async function start() {
  if (isHost) {
    console.log('Skipping Node Client start. Device configured as Host.');
    return;
  }

  const nodeId = await getOrInitNodeId();
  console.log(`Starting Node Edge Client for Node ID: ${nodeId}`);

  // Setup Express server
  const express = require('express');
  const app = express();
  app.use(express.json());

  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  app.use(express.static(publicDir));

  const messagesDir = path.join(__dirname, 'messages');
  if (!fs.existsSync(messagesDir)) {
    fs.mkdirSync(messagesDir, { recursive: true });
  }

  // POST /message stores text inside nested Year/Month/Day folders
  app.post('/message', (req, res) => {
    const { message } = req.body;
    if (message === undefined) {
      return res.status(400).json({ error: 'message body is required' });
    }

    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    const targetDir = path.join(messagesDir, String(yyyy), mm, dd);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let files = [];
    try {
      files = fs.readdirSync(targetDir).filter(f => f.endsWith('.txt'));
    } catch (e) {}

    let targetFile;
    if (files.length === 0) {
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      targetFile = path.join(targetDir, `${hh}-${min}-${ss}.txt`);
    } else {
      files.sort();
      targetFile = path.join(targetDir, files[0]);
    }

    const timestampPrefix = `[${now.toISOString()}]`;
    fs.appendFileSync(targetFile, `${timestampPrefix} ${messageStr}\n`, 'utf8');

    res.json({ success: true, file: path.basename(targetFile), path: path.relative(messagesDir, targetFile).replace(/\\/g, '/') });
  });

  // GET /api/nodes/discovery returns device metadata for discovery scan
  app.get('/api/nodes/discovery', (req, res) => {
    res.json({
      success: true,
      device_type: process.env.DEVICE_TYPE || 'rpi',
      is_main_host: false,
      port: process.env.PORT || 3000
    });
  });

  // GET /api/files lists folders and .txt files under specified subpath
  app.get('/api/files', (req, res) => {
    const relativePath = req.query.path || '';
    const safeSubPath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const searchDir = path.join(messagesDir, safeSubPath);

    if (!fs.existsSync(searchDir)) {
      return res.json({ success: true, files: [] });
    }

    try {
      const entries = fs.readdirSync(searchDir, { withFileTypes: true });
      const files = entries
        .filter(entry => entry.isDirectory() || (entry.isFile() && entry.name.endsWith('.txt')))
        .map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: path.join(safeSubPath, entry.name).replace(/\\/g, '/')
        }));
      res.json({ success: true, files });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/files/content returns text content of a specified .txt file
  app.get('/api/files/content', (req, res) => {
    const relativePath = req.query.path || '';
    const safeSubPath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(messagesDir, safeSubPath);

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || !filePath.endsWith('.txt')) {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      res.json({ success: true, content });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[Node Client] Express Web Server running on port ${port}`);
  });

  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
  const username = process.env.MQTT_USERNAME || '';
  const password = process.env.MQTT_PASSWORD || '';

  const client = mqtt.connect(brokerUrl, {
    username,
    password,
    clientId: nodeId
  });

  client.on('connect', () => {
    console.log(`Connected to Main Host MQTT broker at: ${brokerUrl}`);
    const commandTopic = `nodes/${nodeId}/commands`;
    client.subscribe(commandTopic, (err) => {
      if (err) {
        console.error(`Failed to subscribe to command topic: ${commandTopic}`);
      } else {
        console.log(`Subscribed to command topic: ${commandTopic}`);
      }
    });

    // Start publishing heartbeats
    const publishHeartbeat = () => {
      const payload = JSON.stringify({
        nodeId,
        device_type: process.env.DEVICE_TYPE || 'rpi',
        ip_address: getLocalIpAddress(),
        port: process.env.PORT || 3000,
        os: `${os.type()} ${os.release()} (${os.arch()})`
      });
      client.publish('nodes/heartbeat', payload);
    };

    // Publish immediately on connect
    publishHeartbeat();

    // And then every 60 seconds
    setInterval(publishHeartbeat, 60000);
  });

  client.on('message', async (topic, message) => {
    console.log(`Received payload on topic [${topic}]`);
    let payload = {};
    try {
      payload = JSON.parse(message.toString());
    } catch (e) {
      console.warn('Payload is not valid JSON.');
      return;
    }

    if (payload.command === 'get_system_info') {
      console.log('Processing command: get_system_info');
      
      const tempVal = await getCpuTemp();
      const powerVal = await getPowerReading();
      
      const responseData = {
        node_id: nodeId,
        ip_address: getLocalIpAddress(),
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestamp: new Date().toISOString(),
        temperature: tempVal,
        power: powerVal
      };

      const responseTopic = `nodes/${nodeId}/responses`;
      const responsePayload = JSON.stringify({
        requestId: payload.requestId || null,
        status: 'success',
        data: responseData
      });

      client.publish(responseTopic, responsePayload, { qos: 1 }, () => {
        console.log(`Published response data to topic [${responseTopic}]`);
      });
    }
  });

  client.on('error', (err) => {
    console.error('MQTT Client Error:', err);
  });
}

start();
