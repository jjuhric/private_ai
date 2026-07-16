const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const https = require('https');

// Helper to parse YAML frontmatter + markdown body
function parseMarkdownProfile(mdText) {
  let name = '';
  let description = '';
  let body = mdText;

  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = mdText.match(frontmatterRegex);
  if (match) {
    const yamlText = match[1];
    body = mdText.replace(frontmatterRegex, '').trim();
    
    const lines = yamlText.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.substring(0, colonIndex).trim().toLowerCase();
        const value = line.substring(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key === 'name') name = value;
        else if (key === 'description') description = value;
      }
    }
  }
  return { name, description, body };
}

// Fetch raw content from a URL
router.post('/fetch-url', authenticateToken, (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  https.get(url, (response) => {
    let data = '';
    response.on('data', (chunk) => {
      data += chunk;
    });
    response.on('end', () => {
      res.json({ rawContent: data });
    });
  }).on('error', (err) => {
    res.status(500).json({ error: `Failed to fetch URL: ${err.message}` });
  });
});

// Get all personalities and skills
router.get('/', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const personalities = await db.all('SELECT * FROM custom_personalities ORDER BY created_at DESC');
    const skills = await db.all('SELECT * FROM custom_skills ORDER BY created_at DESC');
    res.json({ personalities, skills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import personality or skill
router.post('/import', authenticateToken, async (req, res) => {
  const { type, content, overrideName, overrideDesc } = req.body;
  if (!type || !content) {
    return res.status(400).json({ error: 'Type and content are required' });
  }

  const { name, description, body } = parseMarkdownProfile(content);
  const finalName = overrideName || name || `Imported ${type === 'personality' ? 'Persona' : 'Skill'} ${Date.now()}`;
  const finalDesc = overrideDesc || description || '';

  try {
    const db = await getDb();
    if (type === 'personality') {
      await db.run(`
        INSERT INTO custom_personalities (name, description, system_prompt, is_active)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          system_prompt = excluded.system_prompt
      `, [finalName, finalDesc, body]);
    } else {
      await db.run(`
        INSERT INTO custom_skills (name, description, instructions, is_active)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          instructions = excluded.instructions
      `, [finalName, finalDesc, body]);
    }
    res.json({ success: true, message: `Successfully imported ${type} "${finalName}".` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle/Activate Personality (exclusive)
router.post('/personalities/activate', authenticateToken, async (req, res) => {
  const { id } = req.body;
  try {
    const db = await getDb();
    await db.run('UPDATE custom_personalities SET is_active = 0');
    await db.run('UPDATE custom_personalities SET is_active = 1 WHERE id = ?', [id]);
    res.json({ success: true, message: 'Personality activated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle Skill (non-exclusive)
router.post('/skills/toggle', authenticateToken, async (req, res) => {
  const { id, is_active } = req.body;
  try {
    const db = await getDb();
    await db.run('UPDATE custom_skills SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, id]);
    res.json({ success: true, message: 'Skill status toggled.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a personality
router.put('/personalities/:id', authenticateToken, async (req, res) => {
  const { name, description, system_prompt } = req.body;
  if (!name || !system_prompt) {
    return res.status(400).json({ error: 'Name and system_prompt are required.' });
  }
  try {
    const db = await getDb();
    await db.run(`
      UPDATE custom_personalities
      SET name = ?, description = ?, system_prompt = ?
      WHERE id = ?
    `, [name, description || '', system_prompt, req.params.id]);
    res.json({ success: true, message: 'Personality updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a skill
router.put('/skills/:id', authenticateToken, async (req, res) => {
  const { name, description, instructions } = req.body;
  if (!name || !instructions) {
    return res.status(400).json({ error: 'Name and instructions are required.' });
  }
  try {
    const db = await getDb();
    await db.run(`
      UPDATE custom_skills
      SET name = ?, description = ?, instructions = ?
      WHERE id = ?
    `, [name, description || '', instructions, req.params.id]);
    res.json({ success: true, message: 'Skill updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a personality
router.delete('/personalities/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const item = await db.get('SELECT is_active FROM custom_personalities WHERE id = ?', [req.params.id]);
    if (item && item.is_active) {
      return res.status(400).json({ error: 'Cannot delete the active personality. Activate another first.' });
    }
    await db.run('DELETE FROM custom_personalities WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Personality deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a skill
router.delete('/skills/:id', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM custom_skills WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Skill deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
