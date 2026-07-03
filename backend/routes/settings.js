const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    let settings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    if (!settings) {
      await db.run('INSERT INTO user_settings (user_id) VALUES (?)', [req.user.id]);
      settings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    }
    
    const { decrypt } = require('../utils/crypto');
    const maskKey = (key) => {
      if (!key) return '';
      const dec = decrypt(key);
      if (dec.length <= 8) return '••••••••';
      return dec.substring(0, 4) + '••••••••' + dec.substring(dec.length - 4);
    };

    const responseSettings = {
      ...settings,
      github_token: settings.github_token ? maskKey(settings.github_token) : '',
      gemini_key: settings.gemini_key ? maskKey(settings.gemini_key) : '',
      local_key: settings.local_key ? maskKey(settings.local_key) : '',
      online_key: settings.online_key ? maskKey(settings.online_key) : ''
    };

    res.json(responseSettings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', authenticateToken, async (req, res) => {
  const { provider, model_name, github_token, gemini_key, local_key, local_url, local_api_style, online_url, online_key, online_provider } = req.body;
  try {
    const db = await getDb();
    const { encrypt } = require('../utils/crypto');
    
    const existing = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]) || {};
    const isMasked = (val) => val && val.includes('••');
    
    const finalGithub = isMasked(github_token) ? existing.github_token : (github_token ? encrypt(github_token) : null);
    const finalGemini = isMasked(gemini_key) ? existing.gemini_key : (gemini_key ? encrypt(gemini_key) : null);
    const finalLocal = isMasked(local_key) ? existing.local_key : (local_key ? encrypt(local_key) : null);
    const finalOnline = isMasked(online_key) ? existing.online_key : (online_key ? encrypt(online_key) : null);

    await db.run(
      `INSERT INTO user_settings (
         user_id, provider, model_name, github_token, gemini_key, local_key, 
         local_url, local_api_style, online_url, online_key, online_provider
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         provider = excluded.provider,
         model_name = excluded.model_name,
         github_token = excluded.github_token,
         gemini_key = excluded.gemini_key,
         local_key = excluded.local_key,
         local_url = COALESCE(excluded.local_url, local_url),
         local_api_style = COALESCE(excluded.local_api_style, local_api_style),
         online_url = COALESCE(excluded.online_url, online_url),
         online_key = excluded.online_key,
         online_provider = COALESCE(excluded.online_provider, online_provider)`,
      [
        req.user.id, provider || 'local', model_name || 'google/gemma-4-e4b', finalGithub, finalGemini, finalLocal,
        local_url || 'http://192.168.1.42:1234/v1', local_api_style || 'openai', online_url, finalOnline, online_provider || 'gemini'
      ]
    );
    res.json({ success: true, message: 'Settings updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/local-models', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const settings = await db.get('SELECT local_url, local_key, local_api_style FROM user_settings WHERE user_id = ?', [req.user.id]);
    const localUrl = settings?.local_url || 'http://192.168.1.42:1234/v1';
    const localApiStyle = settings?.local_api_style || 'openai';
    
    const { decrypt } = require('../utils/crypto');
    const localApiKey = decrypt(settings?.local_key);
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

router.get('/online-models', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const settings = await db.get('SELECT online_url, online_key, online_provider FROM user_settings WHERE user_id = ?', [req.user.id]);
    const provider = settings?.online_provider || 'gemini';
    const url = settings?.online_url;

    const { decrypt } = require('../utils/crypto');
    const key = decrypt(settings?.online_key);

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

module.exports = router;
