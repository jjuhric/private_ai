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
