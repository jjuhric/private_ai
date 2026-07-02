const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Handles operations for the Host Machine Agent.
 * Retrieves CPU, memory, uptime, OS, and disk information.
 * 
 * @param {string} action Action to perform.
 * @param {object} params Action parameters.
 * @returns {Promise<string>} Report on the host machine specifications.
 */
async function handleHostMachineTool(action, params = {}) {
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

    return `### 🖥️ Host Machine Specifications
- **Operating System**: ${type} (${platform} ${release}) - ${arch} Architecture
- **Uptime**: ${uptimeStr}
- **CPU**: ${cpuModel} (${cpuCount} Cores @ ${cpuSpeed} MHz)
- **Memory**: ${usedGB} GB / ${totalGB} GB used (${memPercent}%) - ${freeGB} GB free
- **Load Average (1/5/15 min)**: ${platform === 'win32' ? 'N/A' : loadAvg.map(l => l.toFixed(2)).join(', ')}

### 💾 Disk Volumes
${diskInfo}
`;
  } catch (err) {
    return `Error retrieving host machine specifications: ${err.message}`;
  }
}

module.exports = { handleHostMachineTool };
