const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getDb } = require('../db');
const { listLocalModels, unloadLocalModel, loadLocalModel } = require('../utils/lmstudio');
const { decrypt } = require('../utils/crypto');
const logger = require('../utils/logger');

// Set active tab global state
router.post('/active-tab', authenticateToken, async (req, res) => {
  const { tab } = req.body;
  if (!tab) {
    return res.status(400).json({ error: 'tab is required' });
  }
  global.activeTab = tab;
  logger.info(`[Active Tab] Set global active tab to: ${tab}`);
  res.json({ success: true, activeTab: global.activeTab });
});

// Switch active model based on tab selection
router.post('/switch-model', authenticateToken, async (req, res) => {
  const { modelId } = req.body;
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }

  try {
    const db = await getDb();
    const userSettings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    if (!userSettings) {
      return res.status(404).json({ error: 'User settings not found' });
    }

    // Only swap models if the active provider is local
    if (userSettings.provider !== 'local') {
      return res.json({ success: true, message: 'Provider is not local, skipping LM Studio model switch.' });
    }

    const decryptedLocalKey = decrypt(userSettings.local_key);
    const localBaseUrl = userSettings.local_url || 'http://192.168.1.42:1234/v1';
    const localApiKey = decryptedLocalKey || '';

    logger.info(`[LM Studio Switch] Fetching active loaded models from: ${localBaseUrl}`);
    const availableModels = await listLocalModels(localBaseUrl, localApiKey);
    
    // Check if the desired model is already loaded
    const alreadyLoaded = availableModels.find(m => m.id === modelId && m.isLoaded);
    if (alreadyLoaded) {
      logger.info(`[LM Studio Switch] Model '${modelId}' is already loaded. Skipping.`);
      return res.json({ success: true, message: `Model '${modelId}' is already loaded.` });
    }

    // Unload all currently loaded models
    for (const m of availableModels) {
      if (m.isLoaded && m.instanceId) {
        logger.info(`[LM Studio Switch] Unloading model instance: ${m.instanceId} (${m.id})`);
        try {
          await unloadLocalModel(localBaseUrl, localApiKey, m.instanceId);
        } catch (unloadErr) {
          logger.warn(`[LM Studio Switch] Failed to unload instance ${m.instanceId}: ${unloadErr.message}`);
        }
      }
    }

    // Load the new target model
    logger.info(`[LM Studio Switch] Loading target model: ${modelId}`);
    await loadLocalModel(localBaseUrl, localApiKey, modelId);

    res.json({ success: true, message: `Successfully loaded model ${modelId}` });
  } catch (err) {
    logger.error(`[LM Studio Switch] Failed to switch model to ${modelId}: ${err.message}`);
    res.status(500).json({ error: `Failed to switch model: ${err.message}` });
  }
});

module.exports = router;
