const { getDb } = require('../db');
const { QuotaExceededError } = require('../utils/errors');
const logger = require('../utils/logger');
const mqttService = require('../services/mqtt_service');

async function checkQuota(req, res, next) {
  try {
    const db = await getDb();
    const userId = req.user.id;

    // Get user's quota config
    const settings = await db.get(
      'SELECT token_quota FROM user_settings WHERE user_id = ?',
      [userId]
    );
    const quotaLimit = settings?.token_quota !== undefined ? settings.token_quota : 100000;

    // Get current usage in the last 24 hours
    const usageRow = await db.get(
      `SELECT SUM(token_count) as total FROM token_usage 
       WHERE user_id = ? 
         AND created_at >= datetime('now', '-24 hours')`,
      [userId]
    );
    const totalUsed = usageRow?.total || 0;

    if (totalUsed >= quotaLimit) {
      const errMsg = `Daily token quota exceeded (${totalUsed}/${quotaLimit} tokens used).`;
      logger.warn(`[Quota Enforcer] QUOTA_EXCEEDED: User ID ${userId} is blocked. ${errMsg}`);
      
      // Publish alert to MQTT
      mqttService.publish(`private_ai/nodes/${mqttService.nodeId || 'windows-main'}/alerts`, {
        type: 'error',
        code: 'QUOTA_EXCEEDED',
        message: errMsg,
        userId: userId,
        timestamp: new Date().toISOString()
      });

      // Also invoke the alerts broadcast helper directly if available
      try {
        const alertsBroadcaster = require('../routes/alerts');
        alertsBroadcaster.broadcastAlert({
          type: 'error',
          code: 'QUOTA_EXCEEDED',
          message: errMsg,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        // Broadcaster not initialized or imported yet
      }

      return res.status(429).json({
        error: 'Too Many Requests',
        code: 'QUOTA_EXCEEDED',
        message: errMsg
      });
    }

    next();
  } catch (err) {
    logger.error('Error during quota check middleware execution:', err);
    next(err);
  }
}

module.exports = { checkQuota };
