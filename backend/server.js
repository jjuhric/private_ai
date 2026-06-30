require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('./db');
const { runAgentLoop } = require('./ai');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_private_ai_assistant_2026';

app.use(cors());
app.use(express.json());

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expired or invalid.' });
    req.user = user;
    next();
  });
}

// Database initial validation
getDb().catch(err => {
  console.error('Fatal: Database failed to initialize:', err);
  process.exit(1);
});

// Authentication Routes
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.trim() === '' || password.length < 4) {
    return res.status(400).json({ error: 'Username and password (min 4 characters) are required.' });
  }
  try {
    const db = await getDb();
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing) return res.status(400).json({ error: 'Username is already taken.' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await db.run(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username.trim(), passwordHash]
    );

    // Initialize default user settings
    await db.run(
      'INSERT INTO user_settings (user_id, provider, model_name) VALUES (?, ?, ?)',
      [result.lastID, 'local', 'google/gemma-4-e4b']
    );

    res.json({ success: true, userId: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (!user) return res.status(400).json({ error: 'Invalid username or password.' });

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(400).json({ error: 'Invalid username or password.' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/version', (req, res) => {
  try {
    const pkg = require('../package.json');
    res.json({ version: pkg.version });
  } catch (e) {
    res.json({ version: '1.0.0' });
  }
});

// Profile Routes
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get('SELECT name, zipcode, country, temp_unit, weather_api_key FROM users WHERE id = ?', [req.user.id]);
    res.json(user || { name: '', zipcode: '', country: 'US', temp_unit: 'imperial', weather_api_key: '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  const { name, zipcode, country, temp_unit, weather_api_key } = req.body;
  try {
    const db = await getDb();
    await db.run(
      `UPDATE users SET name = ?, zipcode = ?, country = ?, temp_unit = ?, weather_api_key = ? WHERE id = ?`,
      [name || '', zipcode || '', country || 'US', temp_unit || 'imperial', weather_api_key || '', req.user.id]
    );
    res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings Routes
app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    let settings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    if (!settings) {
      await db.run('INSERT INTO user_settings (user_id) VALUES (?)', [req.user.id]);
      settings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', authenticateToken, async (req, res) => {
  const { provider, model_name, github_token, gemini_key, local_key, local_url, local_api_style, online_url, online_key, online_provider } = req.body;
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO user_settings (
         user_id, provider, model_name, github_token, gemini_key, local_key, 
         local_url, local_api_style, online_url, online_key, online_provider
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         provider = excluded.provider,
         model_name = excluded.model_name,
         github_token = COALESCE(excluded.github_token, github_token),
         gemini_key = COALESCE(excluded.gemini_key, gemini_key),
         local_key = COALESCE(excluded.local_key, local_key),
         local_url = COALESCE(excluded.local_url, local_url),
         local_api_style = COALESCE(excluded.local_api_style, local_api_style),
         online_url = COALESCE(excluded.online_url, online_url),
         online_key = COALESCE(excluded.online_key, online_key),
         online_provider = COALESCE(excluded.online_provider, online_provider)`,
      [
        req.user.id, provider || 'local', model_name || 'google/gemma-4-e4b', github_token, gemini_key, local_key,
        local_url || 'http://192.168.1.42:1234/v1', local_api_style || 'openai', online_url, online_key, online_provider || 'gemini'
      ]
    );
    res.json({ success: true, message: 'Settings updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings/local-models', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const settings = await db.get('SELECT local_url, local_key, local_api_style FROM user_settings WHERE user_id = ?', [req.user.id]);
    const localUrl = settings?.local_url || 'http://192.168.1.42:1234/v1';
    const localApiStyle = settings?.local_api_style || 'openai';
    const localApiKey = settings?.local_key;
    const authHeader = localApiKey && localApiKey !== 'lm-studio' ? { 'Authorization': `Bearer ${localApiKey}` } : {};

    let endpoint = '';
    try {
      const urlObj = new URL(localUrl);
      const origin = urlObj.origin;
      if (localApiStyle === 'lm-studio') {
        endpoint = `${origin}/api/v1/models`;
      } else {
        endpoint = `${origin}/v1/models`;
      }
    } catch (e) {
      endpoint = `${localUrl.replace(/\/$/, '')}/models`;
    }

    const response = await fetch(endpoint, {
      headers: { ...authHeader, 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json();
    const models = data.data ? data.data.map(m => m.id) : [];
    res.json(models);
  } catch (err) {
    console.error('Failed to fetch local models:', err.message);
    res.json([
      'google/gemma-4-e4b',
      'google/gemma-4-e2b',
      'google/gemma-4-12b-qat',
      'qwen/qwen3.5-9b'
    ]);
  }
});

app.get('/api/settings/online-models', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const settings = await db.get('SELECT online_url, online_key, online_provider FROM user_settings WHERE user_id = ?', [req.user.id]);
    const provider = settings?.online_provider || 'gemini';
    const key = settings?.online_key;
    const url = settings?.online_url;

    if (!key) {
      return res.json(getDefaultOnlineModels(provider));
    }

    if (provider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (!response.ok) throw new Error(`Gemini API error: ${response.statusText}`);
      const data = await response.json();
      const models = data.models
        ? data.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''))
          .filter(name => {
            // 1. Exclude checkpoint versions like -001, -002, -003
            if (/-\d{3}$/.test(name)) return false;
            // 2. Exclude tuning, embedding, specialized QA, or other non-chat models
            if (name.includes('tuning') || name.includes('-ft') || name.includes('aqa') || name.includes('embedding') || name.includes('chat')) return false;
            // 3. Exclude deprecated 1.0 models
            if (name.startsWith('gemini-1.0') || name.startsWith('gemini-pro-vision')) return false;
            return true;
          })
        : [];
      return res.json(models.length > 0 ? models : getDefaultOnlineModels('gemini'));
    } else if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      if (!response.ok) throw new Error(`OpenAI API error: ${response.statusText}`);
      const data = await response.json();
      const models = data.data ? data.data.map(m => m.id) : [];
      return res.json(models.length > 0 ? models : getDefaultOnlineModels('openai'));
    } else if (provider === 'custom' && url) {
      let endpoint = `${url.replace(/\/$/, '')}/models`;
      const response = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      if (!response.ok) throw new Error(`Custom API error: ${response.statusText}`);
      const data = await response.json();
      const models = data.data ? data.data.map(m => m.id) : [];
      return res.json(models);
    } else {
      return res.json(getDefaultOnlineModels(provider));
    }
  } catch (err) {
    console.error('Failed to fetch online models:', err.message);
    const db = await getDb().catch(() => null);
    let provider = 'gemini';
    if (db) {
      const settings = await db.get('SELECT online_provider FROM user_settings WHERE user_id = ?', [req.user.id]);
      provider = settings?.online_provider || 'gemini';
    }
    res.json(getDefaultOnlineModels(provider));
  }
});

function getDefaultOnlineModels(provider) {
  if (provider === 'gemini') {
    return ['gemini-2.5-flash'];
  } else if (provider === 'openai') {
    return ['gpt-4o', 'gpt-4o-mini', 'o1-mini'];
  } else if (provider === 'anthropic') {
    return ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'];
  }
  return [];
}


// Calendar Routes
app.get('/api/calendar', authenticateToken, async (req, res) => {
  const { date } = req.query; // YYYY-MM-DD
  try {
    const db = await getDb();
    const queryDate = date || new Date().toISOString().split('T')[0];
    const events = await db.all(
      `SELECT * FROM calendar_events 
       WHERE user_id = ? AND (start_time LIKE ? OR date(start_time) = date(?))
       ORDER BY start_time ASC`,
      [req.user.id, `${queryDate}%`, queryDate]
    );
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar', authenticateToken, async (req, res) => {
  const { title, description, start_time, end_time } = req.body;
  if (!title || !start_time) return res.status(400).json({ error: 'Title and start_time are required' });

  try {
    const db = await getDb();
    const result = await db.run(
      `INSERT INTO calendar_events (user_id, title, description, start_time, end_time) 
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, title, description || '', start_time, end_time || start_time]
    );
    res.json({ success: true, eventId: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/calendar/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM calendar_events WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chats & Message History
app.get('/api/chats', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const chats = await db.all('SELECT * FROM chats WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats', authenticateToken, async (req, res) => {
  const { title } = req.body;
  try {
    const db = await getDb();
    const result = await db.run('INSERT INTO chats (user_id, title) VALUES (?, ?)', [req.user.id, title || 'New Chat']);
    res.json({ success: true, chatId: result.lastID, title: title || 'New Chat' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chats/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/chats/:id', authenticateToken, async (req, res) => {
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

app.get('/api/chats/:id/messages', authenticateToken, async (req, res) => {
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
app.post('/api/chat/stream', authenticateToken, async (req, res) => {
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

    sendEvent('done', { success: true });
  } catch (err) {
    console.error('Stream processing error:', err);
    sendEvent('error', { message: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// Serve static assets from frontend build folder if present
const path = require('path');
const frontendBuildPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendBuildPath));

// Fallback route to serve index.html for React/Vite single page app router
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendBuildPath, 'index.html'), (err) => {
    if (err) {
      res.status(404).send('Frontend not built. Run "npm run build" in frontend folder.');
    }
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Express Backend running securely on port ${PORT}`);
});
