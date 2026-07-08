const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { runAgentLoop, generateGreetingAndSave } = require('../ai');
const { authenticateToken } = require('../middleware/auth');
const { checkQuota } = require('../middleware/quotaMiddleware');
const { getEmbedding } = require('../utils/embeddings');

router.get('/chats', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const chats = await db.all('SELECT * FROM chats WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chats', authenticateToken, async (req, res) => {
  const { title } = req.body;
  try {
    const db = await getDb();
    const result = await db.run('INSERT INTO chats (user_id, title) VALUES (?, ?)', [req.user.id, title || 'New Chat']);
    const chatId = result.lastID;
    
    await generateGreetingAndSave(db, req.user.id, chatId);
    
    res.json({ success: true, chatId, id: chatId, title: title || 'New Chat' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/chats/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/chats/:id', authenticateToken, async (req, res) => {
  const { title } = req.body;
  if (!title || title.trim() === '') return res.status(400).json({ error: 'Title is required.' });
  try {
    const db = await getDb();
    await db.run('UPDATE chats SET title = ? WHERE id = ? AND user_id = ?', [title.trim(), req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/chats/:id/messages', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    // Validate chat ownership
    const chat = await db.get('SELECT id FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });

    const messages = await db.all('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC', [req.params.id]);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent SSE Stream endpoint
router.post('/chat/stream', authenticateToken, checkQuota, async (req, res) => {
  const { chatId, message } = req.body;
  if (!chatId || !message) return res.status(400).json({ error: 'chatId and message are required.' });

  const db = await getDb();

  // Validate chat ownership
  const chat = await db.get('SELECT id FROM chats WHERE id = ? AND user_id = ?', [chatId, req.user.id]);
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });

  // Get user settings
  let settings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
  if (!settings) {
    settings = { provider: 'local', model_name: 'qwen3-8b' };
  }

  // Get chat history
  const dbHistory = await db.all(
    'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT 20',
    [chatId]
  );

  // Format for AI client loop: filter out empty messages and merge consecutive roles
  const history = [];
  for (const msg of dbHistory) {
    const content = msg.content ? msg.content.trim() : '';
    if (!content) continue;

    if (history.length > 0 && history[history.length - 1].role === msg.role) {
      history[history.length - 1].content += "\n" + content;
    } else {
      history.push({ role: msg.role, content });
    }
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const streamAbortController = new AbortController();
  req.on('close', async () => {
    streamAbortController.abort();

    // If provider is local, eject the currently loaded model on abort to free up resources
    if (settings.provider === 'local') {
      try {
        const { decrypt } = require('../utils/crypto');
        const decryptedLocalKey = decrypt(settings.local_key);
        const localBaseUrl = settings.local_url || process.env.LOCAL_LLM_URL || 'http://192.168.1.42:1234/v1';
        const localApiKey = decryptedLocalKey || process.env.LOCAL_LLM_KEY || '';

        const { listLocalModels, unloadLocalModel } = require('../utils/lmstudio');
        const availableModels = await listLocalModels(localBaseUrl, localApiKey);
        const loadedModelObj = availableModels.find(m => m.isLoaded);
        if (loadedModelObj && loadedModelObj.instanceId) {
          console.log(`[Model Ejection] User aborted chat. Ejecting active local model instance: ${loadedModelObj.instanceId}`);
          await unloadLocalModel(localBaseUrl, localApiKey, loadedModelObj.instanceId);
        }
      } catch (ejectErr) {
        console.error('Failed to eject local model on abort:', ejectErr);
      }
    }
  });

  let accumulatedThoughts = '';
  let accumulatedContent = '';

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Keep-alive heartbeat interval
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  try {
    // Save user message to database
    await db.run(
      'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
      [chatId, 'user', message]
    );

    // Resolve preferred model names dynamically
    let actualModel = settings.model_name;
    if (settings.provider === 'local' && settings.preferred_local_model) {
      actualModel = settings.preferred_local_model;
    } else if (settings.provider !== 'local' && settings.preferred_online_model) {
      actualModel = settings.preferred_online_model;
    }

    const { decrypt } = require('../utils/crypto');
    const decryptedGithub = decrypt(settings.github_token);
    const decryptedLocalKey = decrypt(settings.local_key);
    const decryptedOnlineKey = decrypt(settings.online_key);
    const decryptedGeminiKey = decrypt(settings.gemini_key);

    // Trigger Model Selector Agent
    const { selectBestModel } = require('../utils/model_selector');
    const selectorSettings = {
      provider: settings.provider,
      modelName: actualModel,
      onlineProvider: settings.online_provider || 'gemini',
      onlineKey: decryptedOnlineKey || decryptedGeminiKey || process.env.GEMINI_API_KEY || '',
      geminiKey: decryptedGeminiKey || decryptedOnlineKey || process.env.GEMINI_API_KEY || '',
      localBaseUrl: settings.local_url || process.env.LOCAL_LLM_URL || 'http://192.168.1.42:1234/v1',
      localApiKey: decryptedLocalKey || process.env.LOCAL_LLM_KEY || '',
      localApiStyle: settings.local_api_style || 'openai'
    };

    let selectedModel = actualModel;
    try {
      selectedModel = await selectBestModel(selectorSettings, message, history);
    } catch (selErr) {
      console.error('Model selection routing failed:', selErr);
    }

    // If local provider and model changed, handle unloading of old and loading of new
    if (settings.provider === 'local') {
      const { listLocalModels, loadLocalModel, unloadLocalModel } = require('../utils/lmstudio');
      const localBaseUrl = selectorSettings.localBaseUrl;
      const localApiKey = selectorSettings.localApiKey;

      try {
        const availableModels = await listLocalModels(localBaseUrl, localApiKey);
        const loadedModelObj = availableModels.find(m => m.isLoaded);
        const loadedModel = loadedModelObj ? loadedModelObj.id : null;

        if (loadedModel && loadedModel !== selectedModel) {
          sendEvent('thought', `[System] Unloading model '${loadedModel}' and loading '${selectedModel}'... Please wait.\n`);
          console.log(`[Model Switcher] Unloading loaded model: ${loadedModel}`);
          if (loadedModelObj.instanceId) {
            await unloadLocalModel(localBaseUrl, localApiKey, loadedModelObj.instanceId);
          }
          console.log(`[Model Switcher] Loading selected model: ${selectedModel}`);
          await loadLocalModel(localBaseUrl, localApiKey, selectedModel);
        } else if (!loadedModel) {
          // Cold-start load
          sendEvent('thought', `[System] Loading model '${selectedModel}'... Please wait.\n`);
          console.log(`[Model Switcher] Cold loading selected model: ${selectedModel}`);
          await loadLocalModel(localBaseUrl, localApiKey, selectedModel);
        }
      } catch (switchErr) {
        console.error('Local model switching failed:', switchErr);
        sendEvent('thought', `[System] Warning: Local model switching failed: ${switchErr.message}. Proceeding anyway.\n`);
      }
    }

    actualModel = selectedModel;

    // Send the model name to the frontend
    sendEvent('model_used', { model: actualModel });

    // Trigger AI orchestration loop

    await runAgentLoop({
      db,
      userId: req.user.id,
      chatId,
      provider: settings.provider,
      modelName: actualModel,
      supervisorModel: actualModel,
      userMessage: message,
      history,
      githubToken: decryptedGithub || process.env.GITHUB_TOKEN || '',
      localBaseUrl: settings.local_url || process.env.LOCAL_LLM_URL || 'http://192.168.1.42:1234/v1',
      localApiKey: decryptedLocalKey || process.env.LOCAL_LLM_KEY || '',
      localApiStyle: settings.local_api_style || 'openai',
      onlineUrl: settings.online_url,
      onlineKey: decryptedOnlineKey || decryptedGeminiKey || process.env.GEMINI_API_KEY || '',
      geminiKey: decryptedGeminiKey || decryptedOnlineKey || process.env.GEMINI_API_KEY || '',
      onlineProvider: settings.online_provider || 'gemini',
      isAborted: () => streamAbortController.signal.aborted,
      abortSignal: streamAbortController.signal,
      onThought: (thoughtChunk) => {
        accumulatedThoughts += thoughtChunk;
        sendEvent('thought', thoughtChunk);
      },
      onContent: (contentChunk) => {
        accumulatedContent += contentChunk;
        sendEvent('content', contentChunk);
      },
      onToolCall: (toolCall) => {
        sendEvent('tool', toolCall);
      },
      onAgentStatus: (statusData) => {
        sendEvent('agent_status', statusData);
      },
      onCommandApprovalRequired: ({ commandId, command, safety_analysis }) => {
        sendEvent('command_approval_required', { commandId, command, safety_analysis });
      }
    });

    // Save assistant response to database
    let finalContent = accumulatedContent;
    let finalThoughts = accumulatedThoughts;

    const startTag = '<|channel>thought';
    const endTag = '<channel|>';
    if (finalContent.includes(startTag)) {
      const startIdx = finalContent.indexOf(startTag);
      const endIdx = finalContent.indexOf(endTag);
      if (endIdx !== -1) {
        const extractedThoughts = finalContent.substring(startIdx + startTag.length, endIdx).trim();
        finalThoughts = (finalThoughts + '\n' + extractedThoughts).trim();
        finalContent = (finalContent.substring(0, startIdx) + finalContent.substring(endIdx + endTag.length)).trim();
      } else {
        const extractedThoughts = finalContent.substring(startIdx + startTag.length).trim();
        finalThoughts = (finalThoughts + '\n' + extractedThoughts).trim();
        finalContent = finalContent.substring(0, startIdx).trim();
      }
    }

    const startTagXml = '<think>';
    const endTagXml = '</think>';
    if (finalContent.includes(startTagXml)) {
      const startIdx = finalContent.indexOf(startTagXml);
      const endIdx = finalContent.indexOf(endTagXml);
      if (endIdx !== -1) {
        const extractedThoughts = finalContent.substring(startIdx + startTagXml.length, endIdx).trim();
        finalThoughts = (finalThoughts + '\n' + extractedThoughts).trim();
        finalContent = (finalContent.substring(0, startIdx) + finalContent.substring(endIdx + endTagXml.length)).trim();
      } else {
        const extractedThoughts = finalContent.substring(startIdx + startTagXml.length).trim();
        finalThoughts = (finalThoughts + '\n' + extractedThoughts).trim();
        finalContent = finalContent.substring(0, startIdx).trim();
      }
    }

    await db.run(
      'INSERT INTO messages (chat_id, role, content, thoughts) VALUES (?, ?, ?, ?)',
      [chatId, 'assistant', finalContent, finalThoughts]
    );

    const userSettings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]) || {};
    const chatMemContent = `User asked: "${message.trim()}"\nAssistant replied: "${finalContent.trim()}"`;
    const chatMemEmbedding = await getEmbedding(chatMemContent, userSettings);

    // Save Q&A to short-term memory vault for 24 hours
    const expires24h = new Date();
    expires24h.setDate(expires24h.getDate() + 1);
    await db.run(
      'INSERT INTO memories (user_id, content, level, expires_at, embedding) VALUES (?, ?, ?, ?, ?)',
      [
        req.user.id,
        chatMemContent,
        'short-term',
        expires24h.toISOString(),
        chatMemEmbedding ? JSON.stringify(chatMemEmbedding) : null
      ]
    );

    sendEvent('agent_status', { agent: null, status: 'idle' });
    sendEvent('done', { success: true });
  } catch (err) {
    console.error('Stream processing error:', err);
    sendEvent('error', { message: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

router.post('/chat/approve-command', authenticateToken, (req, res) => {
  const { commandId, approved, command, password } = req.body;
  if (!commandId) return res.status(400).json({ error: 'commandId is required.' });
  
  const { resolveCommand } = require('../utils/commandApproval');
  const success = resolveCommand(commandId, approved, command, password);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Command not found or already resolved.' });
  }
});

module.exports = router;
