require('dotenv').config();
process.env.GIT_TERMINAL_PROMPT = '0';
process.env.GCM_INTERACTIVE = 'never';
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');
const cron = require('node-cron');

// Global tracker to handle Rule 8 busy checking across the system
global.activeAgentOps = global.activeAgentOps || 0;

// Secure JWT_SECRET check in production
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not configured in production mode.');
  process.exit(1);
}

// Import modular routers
const authRouter = require('./routes/auth');
const profileRouter = require('./routes/profile');
const settingsRouter = require('./routes/settings');
const calendarRouter = require('./routes/calendar');
const chatRouter = require('./routes/chat');
const memoryRouter = require('./routes/memory');
const vaultRouter = require('./routes/vault');
const updateRouter = require('./routes/update');
const hostRouter = require('./routes/host');
const agentBridgeRouter = require('./routes/agent_bridge');
const nodesRouter = require('./routes/nodes');
const tokenUsageRouter = require('./routes/token_usage');
const lmstudioRouter = require('./routes/lmstudio');
const alertsRouter = require('./routes/alerts');
const lmstudioSwitchRouter = require('./routes/lmstudio_switch');
const personalitiesSkillsRouter = require('./routes/personalities_skills');
const mqttService = require('./services/mqtt_service');

const app = express();
const PORT = process.env.PORT || 3000;

// Helper to check if origin is a local private network subnet
const isLocalOrigin = (origin) => {
  const localRegex = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|[a-zA-Z0-9-]+\.local)(:\d+)?$/;
  return localRegex.test(origin);
};

// Restrict CORS origins in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    if (isLocalOrigin(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Initialize database connection and schedule daily memory maintenance
const logger = require('./utils/logger');
getDb().then(async (db) => {
  logger.info('Database initialized successfully.');
  try {
    // Initialize MQTT client
    mqttService.init();

    // Probe and log node identity
    const nodeIdentity = require('./services/node_identity');
    const identity = await nodeIdentity.getIdentity();
    logger.info(`[Node Startup] Node Identity: ${JSON.stringify(identity)}`);


    const { runDailyMemoryCheck } = require('./tools/memory_tool');
    await runDailyMemoryCheck(db);

    // Set 24 hour interval check
    setInterval(async () => {
      await runDailyMemoryCheck(db);
    }, 24 * 60 * 60 * 1000);
    // Start automatic check daemon
    if (process.env.NODE_ENV !== 'test') {
      const safeUpdateService = require('./services/safe_update_service');
      safeUpdateService.startDaemon();

      const nodeHealthService = require('./services/node_health_service');
      nodeHealthService.startDaemon();

      const researchDaemon = require('./services/research_daemon');
      researchDaemon.startDaemon();
    }
  } catch (err) {
    logger.error('Error starting daily memory maintenance check:', err);
  }
}).catch(err => {
  logger.error('Fatal: Database failed to initialize:', err);
  process.exit(1);
});

// Mount modular routes
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/settings', lmstudioSwitchRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/memories', memoryRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/update', updateRouter);
app.use('/api/host', hostRouter);
app.use('/api/bridge', agentBridgeRouter);
app.use('/api/agent-bridge', agentBridgeRouter);
app.use('/api/nodes', nodesRouter);
app.use('/api/personalities-skills', personalitiesSkillsRouter);
app.use('/api/token-usage', tokenUsageRouter);
app.use('/api/lmstudio', lmstudioRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api', chatRouter); // Routes handle their own prefixing (e.g. /chats, /chat/stream)

// Root health check endpoint (unauthenticated, for node monitoring)
app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'online' });
});

// Version info helper
app.get('/api/version', (req, res) => {
  try {
    const pkg = require('../package.json');
    const os = require('os');
    const host_ips = [];
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const netObj of interfaces[name]) {
        if (netObj.family === 'IPv4') {
          host_ips.push(netObj.address);
        }
      }
    }
    res.json({ version: pkg.version, host_ips });
  } catch (e) {
    res.json({ version: '1.0.0', host_ips: [] });
  }
});

// Serve static assets from frontend build folder if present
const frontendBuildPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendBuildPath));

// Serve standalone monitor dashboard from monitor_dashboard/dist if present
const monitorBuildPath = path.join(__dirname, '../monitor_dashboard/dist');
app.get('/monitor', (req, res, next) => {
  const pathPart = req.originalUrl.split('?')[0];
  if (pathPart === '/monitor') {
    const query = Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '';
    return res.redirect(301, '/monitor/' + query);
  }
  next();
});
app.use('/monitor', express.static(monitorBuildPath));
app.get('/monitor/*', (req, res) => {
  res.sendFile(path.join(monitorBuildPath, 'index.html'));
});

// Serve dynamically generated TTS audio files
const ttsDir = path.join(__dirname, 'public/tts');
if (!fs.existsSync(ttsDir)) {
  fs.mkdirSync(ttsDir, { recursive: true });
}
app.use('/tts', express.static(ttsDir));

// Expose TTS generation API endpoint
const { generateTTS } = require('./utils/tts');
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }
    const audioUrl = await generateTTS(text);
    res.json({ audioUrl });
  } catch (err) {
    logger.error('TTS API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Fallback route to serve index.html for React/Vite single page app router
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/monitor')) {
    return next();
  }
  res.sendFile(path.join(frontendBuildPath, 'index.html'), (err) => {
    if (err) {
      logger.error('Error sending index.html:', err);
      res.status(404).send('Frontend not built. Run "npm run build" in frontend folder.');
    }
  });
});

// Start Server
let server;
const https = require('https');
const certPath = path.join(__dirname, 'certs/tailscale.crt');
const keyPath = path.join(__dirname, 'certs/tailscale.key');

const startScheduler = () => {
  // Initialize briefing scheduler background loop if not running unit tests
  if (process.env.NODE_ENV !== 'test') {
    const { getDb } = require('./db');
    const { startBriefingScheduler } = require('./utils/briefing');
    getDb().then(db => {
      // Temporarily disabled daily-notifications as it is not working for now.
      // startBriefingScheduler(db);
    }).catch(err => {
      logger.error('Failed to start briefing scheduler:', err);
    });
  }
};

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  try {
    const credentials = {
      key: fs.readFileSync(keyPath, 'utf8'),
      cert: fs.readFileSync(certPath, 'utf8')
    };
    server = https.createServer(credentials, app).listen(PORT, () => {
      logger.info(`Express Backend running securely over HTTPS on port ${PORT}`);
      startScheduler();
    });
  } catch (err) {
    logger.error('Failed to start HTTPS server, falling back to HTTP:', err);
    server = app.listen(PORT, () => {
      logger.info(`Express Backend running securely on port ${PORT}`);
      startScheduler();
    });
  }
} else {
  server = app.listen(PORT, () => {
    logger.info(`Express Backend running securely on port ${PORT}`);
    startScheduler();
  });
}

// Initialize WebSocket terminal service
const terminalService = require('./services/terminal_service');
terminalService.init(server);

// Handle graceful shutdown
const gracefulShutdown = () => {
  logger.info('SIGTERM/SIGINT received. Shutting down gracefully...');
  mqttService.disconnect();

  // Force exit after 3 seconds if connections don't close cleanly
  setTimeout(() => {
    logger.warn('Forcing exit after timeout during graceful shutdown.');
    process.exit(0);
  }, 3000);

  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);




