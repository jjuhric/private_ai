const express = require('express');
const router = express.Router();
const os = require('os');
const { authenticateToken } = require('../middleware/auth');
const { handleHostMachineTool } = require('../tools/host_machine_tool');
const { getDb } = require('../db');

router.get('/status', authenticateToken, async (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const uptime = os.uptime();
    
    // CPU usage estimation
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCores = cpus.length;

    // Get telemetry from tools
    const tempReport = await handleHostMachineTool('get_temperature');
    const powerReport = await handleHostMachineTool('get_power');
    const netReport = await handleHostMachineTool('get_network_info');
    const capabilities = await handleHostMachineTool('get_capabilities', {}, req.user.id);

    res.json({
      deviceType: capabilities.deviceType,
      isMainHost: capabilities.isMainHost,
      capabilities: capabilities.capabilities,
      cpu: {
        model: cpuModel,
        cores: cpuCores,
        loadAvg: os.loadavg()
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
        percentage: ((totalMem - freeMem) / totalMem * 100).toFixed(1)
      },
      uptime: uptime,
      telemetry: {
        temperature: tempReport,
        power: powerReport,
        network: netReport
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restart systemd service
router.post('/service/restart', authenticateToken, async (req, res) => {
  const { service } = req.body;
  if (!service) return res.status(400).json({ error: 'Service name is required' });
  
  try {
    const result = await handleHostMachineTool('restart_service', { service });
    if (result.includes('Successfully')) {
      res.json({ success: true, message: result });
    } else {
      res.status(400).json({ error: result });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger GPIO script execution
router.post('/gpio/run', authenticateToken, async (req, res) => {
  const { scriptPath } = req.body;
  if (!scriptPath) return res.status(400).json({ error: 'scriptPath is required' });

  try {
    const result = await handleHostMachineTool('run_script', { scriptPath });
    res.json({ success: true, output: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
