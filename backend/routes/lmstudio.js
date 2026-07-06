const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const { authenticateToken } = require('../middleware/auth');
const { getDb } = require('../db');

router.get('/log-stream', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const settings = await db.get('SELECT is_main_host FROM user_settings WHERE user_id = ?', [req.user.id]);
    
    if (!settings || settings.is_main_host !== 1) {
      return res.status(403).json({ error: 'Only the main host is authorized to stream logs.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log('[LM Studio Logs] Starting lms log stream process...');
    const child = spawn('lms', ['log', 'stream', '--json'], { shell: true });

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          res.write(`data: ${JSON.stringify({ type: 'log', message: line.trim() })}\n\n`);
        }
      }
    });

    child.stderr.on('data', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'stderr', message: data.toString().trim() })}\n\n`);
    });

    child.on('error', (err) => {
      console.error('[LM Studio Logs] Spawn error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: `Failed to spawn lms CLI: ${err.message}. Make sure lms CLI is installed.` })}\n\n`);
    });

    child.on('close', (code) => {
      console.log(`[LM Studio Logs] lms process closed with code ${code}`);
      res.write(`data: ${JSON.stringify({ type: 'error', message: `LM Studio log stream disconnected (exit code ${code})` })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      console.log('[LM Studio Logs] Client disconnected. Killing lms process.');
      child.kill('SIGINT');
    });

  } catch (err) {
    console.error('[LM Studio Logs] Router error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

module.exports = router;
