const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { runAgentLoop } = require('../ai');
const { authenticateToken } = require('../middleware/auth');

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
    res.json({ success: true, chatId: result.lastID, title: title || 'New Chat' });
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
router.post('/chat/stream', authenticateToken, async (req, res) => {
  const { chatId, message } = req.body;
  if (!chatId || !message) return res.status(400).json({ error: 'chatId and message are required.' });

  const db = await getDb();

  // Validate chat ownership
  const chat = await db.get('SELECT id FROM chats WHERE id = ? AND user_id = ?', [chatId, req.user.id]);
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });

  // Get user settings
  let settings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
  if (!settings) {
    settings = { provider: 'local', model_name: 'google/gemma-4-e4b' };
  }

  // Get chat history
  const dbHistory = await db.all(
    'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT 20',
    [chatId]
  );

  // Format for AI client loop
  const history = dbHistory.map(m => ({ role: m.role, content: m.content }));

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

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

    // Trigger AI orchestration loop
    await runAgentLoop({
      db,
      userId: req.user.id,
      provider: settings.provider,
      modelName: settings.model_name,
      userMessage: message,
      history,
      githubToken: settings.github_token,
      localBaseUrl: settings.local_url || 'http://192.168.1.42:1234/v1',
      localApiKey: settings.local_key,
      localApiStyle: settings.local_api_style || 'openai',
      onlineUrl: settings.online_url,
      onlineKey: settings.online_key,
      onlineProvider: settings.online_provider || 'gemini',
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
      }
    }

    await db.run(
      'INSERT INTO messages (chat_id, role, content, thoughts) VALUES (?, ?, ?, ?)',
      [chatId, 'assistant', finalContent, finalThoughts]
    );

    // Save Q&A to short-term memory vault for 24 hours
    const expires24h = new Date();
    expires24h.setDate(expires24h.getDate() + 1);
    await db.run(
      'INSERT INTO memories (user_id, content, level, expires_at) VALUES (?, ?, ?, ?)',
      [
        req.user.id,
        `User asked: "${message.trim()}"\nAssistant replied: "${finalContent.trim()}"`,
        'short-term',
        expires24h.toISOString()
      ]
    );

    sendEvent('done', { success: true });
  } catch (err) {
    console.error('Stream processing error:', err);
    sendEvent('error', { message: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

module.exports = router;
