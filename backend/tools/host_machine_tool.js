const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const execPromise = util.promisify(exec);
const { measurePower } = require('./ina219_tool');
const { measureCpuTemp } = require('./temp_tool');

// Helper to resolve paths safely relative to the workspace directory
function resolveSafePath(userPath) {
  const workspaceRoot = path.resolve(process.cwd());
  const resolved = path.resolve(workspaceRoot, userPath);
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error('Access denied: path is outside the workspace directory.');
  }
  return resolved;
}

/**
 * Helper to fetch power/battery info via INA219 helper script.
 */
async function getPowerInfo() {
  try {
    const data = await measurePower();
    if (!data.success) {
      return `### ⚡ Power & Battery Status (Simulated/Warning)
- **Status**: ${data.error || 'Simulated'}
- **Battery Level**: ${data.battery_percent || 0}%
- **Power Draw**: ${data.power_w || 0} W
- **Voltage**: ${data.voltage_v || 0} V
- **Current**: ${data.current_a || 0} A`;
    }

    let statusHeader = `### ⚡ Power & Battery Status`;
    if (data.simulated) {
      statusHeader = `### ⚡ Power & Battery Status (Simulated)`;
    }

    const readingsStr = data.readings.map((r, i) => {
      return `#### Reading ${i + 1}
- **Battery Level**: ${r.battery_percent}%
- **Power Draw**: ${r.power_w} W
- **Voltage**: ${r.voltage_v} V
- **Current**: ${r.current_a} A`;
    }).join('\n\n');

    return `${statusHeader}

${readingsStr}

#### 📊 3-Sample Average
- **Battery Level**: ${data.average.battery_percent}%
- **Power Draw**: ${data.average.power_w} W
- **Voltage**: ${data.average.voltage_v} V
- **Current**: ${data.average.current_a} A`;
  } catch (err) {
    return `### ⚡ Power & Battery Status
- **Error**: Failed to read power telemetry: ${err.message}`;
  }
}

/**
 * Helper to fetch CPU temperature info via native temp_tool.
 */
async function getTemperatureInfo() {
  try {
    const data = await measureCpuTemp();
    if (!data.success) {
      return `### 🌡️ CPU Temperature (Simulated/Warning)
- **Status**: ${data.error || 'Failed to read CPU temperature'}`;
    }

    let statusHeader = `### 🌡️ CPU Temperature`;
    if (data.simulated) {
      statusHeader = `### 🌡️ CPU Temperature (Simulated)`;
    }

    const readingsStr = data.readings.map((r, i) => {
      return `- **Reading ${i + 1}**: ${r.celsius}°C (${r.fahrenheit}°F)`;
    }).join('\n');

    return `${statusHeader}
${readingsStr}

#### 📊 3-Sample Average
- **Average Temperature**: ${data.average.celsius}°C (${data.average.fahrenheit}°F)`;
  } catch (err) {
    return `### 🌡️ CPU Temperature
- **Error**: Failed to read CPU temperature: ${err.message}`;
  }
}

/**
 * Handles operations for the Host Machine Agent.
 * Retrieves CPU, memory, uptime, OS, disk, and power information.
 * 
 * @param {string} action Action to perform
 * @param {object} params Action parameters.
 * @returns {Promise<string>} Report on the host machine specifications.
 */
async function handleHostMachineTool(action, params = {}, userId = 1) {
  const { getDb } = require('../db');
  let deviceType = 'windows';
  let isMainHost = 1;
  if (process.env.DEVICE_TYPE_OVERRIDE) {
    deviceType = process.env.DEVICE_TYPE_OVERRIDE;
  } else {
    try {
      const db = await getDb();
      const settings = await db.get('SELECT device_type, is_main_host FROM user_settings WHERE user_id = ?', [userId]);
      if (settings) {
        deviceType = settings.device_type || 'windows';
        isMainHost = settings.is_main_host;
      }
    } catch (e) {}
  }

  const DEVICE_CAPABILITIES = {
    'windows': { gpio: false, i2c: false, systemd: false, powershell: true, taskManager: true, registry: true },
    'rpi-zero-2w': { gpio: true, i2c: true, systemd: true, powershell: false, taskManager: false },
    'rpi-3b': { gpio: true, i2c: true, systemd: true, powershell: false, taskManager: false },
    'rpi-4b-2gb': { gpio: true, i2c: true, systemd: true, powershell: false, taskManager: false },
    'rpi-5-8gb': { gpio: true, i2c: true, systemd: true, nvme: true, powershell: false },
    'rpi-5-15gb': { gpio: true, i2c: true, systemd: true, nvme: true, powershell: false },
    'esp32': { gpio: true, i2c: true, systemd: false, powershell: false, wifi: true },
    'esp32-s2': { gpio: true, i2c: true, systemd: false, powershell: false, wifi: true },
    'esp32-s3': { gpio: true, i2c: true, systemd: false, powershell: false, wifi: true },
    'esp32-c3': { gpio: true, i2c: true, systemd: false, powershell: false, wifi: true },
    'esp32-c6': { gpio: true, i2c: true, systemd: false, powershell: false, wifi: true }
  };
  
  // Use prefix matching for generic rpi or esp32 if exact match not found
  let capabilities = DEVICE_CAPABILITIES[deviceType];
  if (!capabilities) {
    if (deviceType.startsWith('rpi')) capabilities = DEVICE_CAPABILITIES['rpi-5-8gb'];
    else if (deviceType.startsWith('esp32')) capabilities = DEVICE_CAPABILITIES['esp32'];
    else capabilities = DEVICE_CAPABILITIES['windows'];
  }

  if (action === 'get_capabilities') {
    return { deviceType, isMainHost, capabilities };
  }

  if (action === 'get_power') {
    return await getPowerInfo();
  }
  if (action === 'get_temperature') {
    return await getTemperatureInfo();
  }
  if (action === 'get_network_info') {
    try {
      const platform = os.platform();
      if (platform === 'win32') {
        const { stdout } = await execPromise('ipconfig');
        return `### 📶 Windows Network Information\n\`\`\`\n${stdout}\n\`\`\``;
      } else {
        const { stdout: ipAddr } = await execPromise('ip addr || hostname -I');
        let wifiInfo = '';
        try {
          const { stdout: iw } = await execPromise('iwconfig 2>/dev/null');
          wifiInfo = `\n### 📶 WiFi Configuration\n\`\`\`\n${iw}\n\`\`\``;
        } catch (e) {}
        return `### 📶 Linux Network Information\n\`\`\`\n${ipAddr}\n\`\`\`${wifiInfo}`;
      }
    } catch (err) {
      return `Error retrieving network info: ${err.message}`;
    }
  }
  if (action === 'get_process_list') {
    try {
      const platform = os.platform();
      const cmd = platform === 'win32'
        ? 'tasklist'
        : 'ps aux --sort=-%cpu | head -n 15';
      const { stdout } = await execPromise(cmd);
      const output = stdout.length > 2000 ? stdout.substring(0, 2000) + '\n... [Truncated]' : stdout;
      return `### 📊 Host Process List (Top CPU/Memory)\n\`\`\`\n${output}\n\`\`\``;
    } catch (err) {
      return `Error retrieving process list: ${err.message}`;
    }
  }
  if (action === 'get_service_status') {
    const { service } = params;
    if (!service) return 'Error: "service" parameter is required.';
    try {
      if (!capabilities.systemd) {
        return `Service status check for "${service}" is only supported on devices with systemd (current: ${deviceType}).`;
      }
      const { stdout } = await execPromise(`systemctl status ${service}`);
      return `### ⚙️ Service Status: ${service}\n\`\`\`\n${stdout}\n\`\`\``;
    } catch (err) {
      return `Error checking service status: ${err.message}\nStdout/Stderr:\n${err.stdout || ''}\n${err.stderr || ''}`;
    }
  }
  if (action === 'get_journal_logs') {
    const { service, lines } = params;
    if (!service) return 'Error: "service" parameter is required.';
    const numLines = lines || 50;
    try {
      if (!capabilities.systemd) {
        return `Service journal log check is only supported on devices with systemd (current: ${deviceType}).`;
      }
      const { stdout } = await execPromise(`journalctl -u ${service} -n ${numLines}`);
      return `### 📜 Journal Logs for ${service} (Last ${numLines} lines)\n\`\`\`\n${stdout}\n\`\`\``;
    } catch (err) {
      return `Error reading journal logs: ${err.message}`;
    }
  }
  if (action === 'restart_service') {
    const { service } = params;
    if (!service) return 'Error: "service" parameter is required.';
    try {
      if (!capabilities.systemd) {
        return `Service restart is only supported on devices with systemd (current: ${deviceType}).`;
      }
      await execPromise(`sudo systemctl restart ${service}`);
      return `Successfully restarted service "${service}".`;
    } catch (err) {
      return `Error restarting service: ${err.message}`;
    }
  }
  if (action === 'run_script') {
    const { scriptPath } = params;
    if (!scriptPath) return 'Error: "scriptPath" parameter is required.';
    try {
      const safePath = resolveSafePath(scriptPath);
      if (!fs.existsSync(safePath)) {
        return `Error: Script not found at "${scriptPath}".`;
      }
      const ext = path.extname(safePath);
      const runner = ext === '.py' ? 'python3' : ext === '.sh' ? 'bash' : '';
      const cmd = runner ? `${runner} "${safePath}"` : `"${safePath}"`;
      const { stdout, stderr } = await execPromise(cmd, { cwd: process.cwd() });
      let output = '';
      if (stdout) output += `### Script Output (Stdout):\n${stdout}\n`;
      if (stderr) output += `### Script Error (Stderr):\n${stderr}\n`;
      return output || 'Script executed successfully with no output.';
    } catch (err) {
      return `Script execution failed: ${err.message}\n${err.stdout ? `Stdout:\n${err.stdout}\n` : ''}${err.stderr ? `Stderr:\n${err.stderr}\n` : ''}`;
    }
  }
  if (action === 'check_updates') {
    try {
      if (os.platform() === 'win32') {
        return 'System package update check is only supported on Debian/Ubuntu Linux.';
      }
      const { stdout } = await execPromise('apt-get -s upgrade');
      return `### 🔄 Dry Run System Package Updates (apt-get -s upgrade)\n\`\`\`\n${stdout}\n\`\`\``;
    } catch (err) {
      return `Error checking updates: ${err.message}`;
    }
  }

  try {
    const platform = os.platform();
    const release = os.release();
    const type = os.type();
    const arch = os.arch();
    const uptime = os.uptime();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    // Formatted uptime
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    // Formatted memory
    const totalGB = (totalMem / (1024 ** 3)).toFixed(2);
    const freeGB = (freeMem / (1024 ** 3)).toFixed(2);
    const usedGB = (Number(totalGB) - Number(freeGB)).toFixed(2);
    const memPercent = ((totalMem - freeMem) / totalMem * 100).toFixed(1);

    // CPU details
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCount = cpus.length;
    const cpuSpeed = cpus[0]?.speed || 'Unknown';

    let diskInfo = 'Disk space check not supported on this platform';
    try {
      if (platform === 'win32') {
        // Execute powershell script to retrieve drive specs
        const { stdout } = await execPromise('powershell -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free | ConvertTo-Json"');
        if (stdout.trim()) {
          const drives = JSON.parse(stdout);
          const driveList = Array.isArray(drives) ? drives : [drives];
          diskInfo = driveList
            .filter(d => d.Name)
            .map(d => {
              const used = d.Used ? (Number(d.Used) / (1024 ** 3)).toFixed(1) : '0.0';
              const free = d.Free ? (Number(d.Free) / (1024 ** 3)).toFixed(1) : '0.0';
              const total = (Number(used) + Number(free)).toFixed(1);
              const percent = Number(total) > 0 ? (Number(used) / Number(total) * 100).toFixed(1) : '0.0';
              return `- Drive ${d.Name}: ${used} GB / ${total} GB used (${percent}%) - ${free} GB free`;
            })
            .join('\n');
        } else {
          diskInfo = 'No file systems detected.';
        }
      } else {
        const { stdout } = await execPromise('df -h /');
        diskInfo = stdout.trim();
      }
    } catch (e) {
      diskInfo = `Failed to retrieve disk info: ${e.message}`;
    }

    const powerInfo = await getPowerInfo();

    return `### 🖥️ Host Machine Specifications
- **Operating System**: ${type} (${platform} ${release}) - ${arch} Architecture
- **Uptime**: ${uptimeStr}
- **CPU**: ${cpuModel} (${cpuCount} Cores @ ${cpuSpeed} MHz)
- **Memory**: ${usedGB} GB / ${totalGB} GB used (${memPercent}%) - ${freeGB} GB free
- **Load Average (1/5/15 min)**: ${platform === 'win32' ? 'N/A' : loadAvg.map(l => l.toFixed(2)).join(', ')}

### 💾 Disk Volumes
${diskInfo}

${powerInfo}
`;
  } catch (err) {
    return `Error retrieving host machine specifications: ${err.message}`;
  }
}

module.exports = { handleHostMachineTool };
