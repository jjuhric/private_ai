const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const activeClients = new Set();

router.get('/stream', authenticateToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  activeClients.add(res);
  logger.info(`[Alerts Stream] Client connected. Total active clients: ${activeClients.size}`);

  // Send keep-alive heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    activeClients.delete(res);
    logger.info(`[Alerts Stream] Client disconnected. Total active clients: ${activeClients.size}`);
  });
});

function broadcastAlert(alert) {
  logger.info(`[Alerts Stream] Broadcasting system alert: ${JSON.stringify(alert)}`);
  const data = typeof alert === 'object' ? JSON.stringify(alert) : alert;
  
  for (const client of activeClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (err) {
      logger.error('[Alerts Stream] Failed to write alert to client:', err);
    }
  }
}

module.exports = router;
module.exports.broadcastAlert = broadcastAlert;
