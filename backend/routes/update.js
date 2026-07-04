const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { exec } = require('child_process');

// Verify GitHub-style HMAC-SHA256 signature
function verifySignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch (e) {
    return false;
  }
}

// Note: Requires raw body parsing so we can verify the HMAC signature correctly
router.post('/', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.UPDATE_WEBHOOK_SECRET;
  const sig = req.headers['x-hub-signature-256'];

  if (!secret) {
    console.warn('Auto-update webhook received, but UPDATE_WEBHOOK_SECRET is not configured.');
    return res.status(500).json({ error: 'Webhook secret not configured on host.' });
  }

  if (!sig || !verifySignature(req.body, sig, secret)) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  res.json({ status: 'update_queued' });

  // Run update commands asynchronously in the background
  console.log('Update webhook validated. Starting pull & rebuild process...');
  const updateCmd = process.env.DEPLOY_MODE === 'backend-only'
    ? 'git pull origin main && npm install && sudo systemctl restart private-ai'
    : 'git pull origin main && npm run install:all && npm run build && sudo systemctl restart private-ai';
  exec(updateCmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
    if (err) {
      console.error(`Auto-update execution failed: ${err.message}`);
    } else {
      console.log('Auto-update completed successfully.');
    }
  });
});

module.exports = router;
