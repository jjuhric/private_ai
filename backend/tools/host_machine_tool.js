const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const execPromise = util.promisify(exec);
const { measurePower } = require('./ina219_tool');
const { measureCpuTemp } = require('./temp_tool');

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
 * @param {string} action Action to perform: 'get_specifications' or 'get_power'.
 * @param {object} params Action parameters.
 * @returns {Promise<string>} Report on the host machine specifications.
 */
async function handleHostMachineTool(action, params = {}) {
  if (action === 'get_power') {
    return await getPowerInfo();
  }
  if (action === 'get_temperature') {
    return await getTemperatureInfo();
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
