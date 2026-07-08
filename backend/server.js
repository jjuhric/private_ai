require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');

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
app.use(express.json());

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

    // Start Centralized Repository Tool Synchronization (Rule 8)
    if (process.env.NODE_ENV !== 'test') {
      const systemMachineName = identity.node_name || 'Windows-Host';
      initializeCentralizedToolSynchronizationDaemon(db, systemMachineName);
    }
    
    const { runDailyMemoryCheck } = require('./tools/memory_tool');
    await runDailyMemoryCheck(db);
    
    // Set 24 hour interval check
    setInterval(async () => {
      await runDailyMemoryCheck(db);
    }, 24 * 60 * 60 * 1000);
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
app.use('/api/calendar', calendarRouter);
app.use('/api/memories', memoryRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/update', updateRouter);
app.use('/api/host', hostRouter);
app.use('/api/bridge', agentBridgeRouter);
app.use('/api/nodes', nodesRouter);
app.use('/api/token-usage', tokenUsageRouter);
app.use('/api/lmstudio', lmstudioRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api', chatRouter); // Routes handle their own prefixing (e.g. /chats, /chat/stream)

// Version info helper
app.get('/api/version', (req, res) => {
  try {
    const pkg = require('../package.json');
    res.json({ version: pkg.version });
  } catch (e) {
    res.json({ version: '1.0.0' });
  }
});

// Serve static assets from frontend build folder if present
const frontendBuildPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendBuildPath));

// Fallback route to serve index.html for React/Vite single page app router
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
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
const server = app.listen(PORT, () => {
  logger.info(`Express Backend running securely on port ${PORT}`);
  
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
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  logger.info('SIGTERM/SIGINT received. Shutting down gracefully...');
  mqttService.disconnect();
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

/**
 * Rule 8: 4-Hour Tool Ingestion Engine with Active Request Postponement Fallbacks
 */
function initializeCentralizedToolSynchronizationDaemon(db, systemMachineName) {
  const TOOLS_REPO_URL = process.env.TOOL_REGISTRY_REPO || 'https://github.com/jjuhric/private_ai_tools.git';
  const registryLocalPath = process.env.TOOL_REGISTRY_LOCAL_PATH || './tool_registry';
  const PRODUCTION_REGISTRY_DIR = path.resolve(registryLocalPath);
  const LOCAL_STAGING_DIR = path.join(PRODUCTION_REGISTRY_DIR, 'staging');
  const fs = require('fs');
  const { exec } = require('child_process');

  const executeSyncPipeline = async () => {
    // INTERCEPT: If the core system is currently busy executing agent logic threads, defer sync
    if (global.activeAgentOps > 0) {
      logger.info(`[Tool Sync Daemon] Deferring repository pull. System is busy handling active agent executions. Retrying in 5 minutes...`);
      setTimeout(executeSyncPipeline, 5 * 60 * 1000); // 5-minute fallback check loop
      return;
    }

    logger.info(`[Tool Sync Daemon] Executing scheduled centralized module checking routines...`);

    let token = process.env.GITHUB_TOKEN || '';
    try {
      const settings = await db.get('SELECT github_token FROM user_settings LIMIT 1');
      if (settings && settings.github_token) {
        const { decrypt } = require('./utils/crypto');
        token = decrypt(settings.github_token);
      }
    } catch (err) {
      // Database might not be initialized or table empty yet
    }

    let authenticatedUrl = TOOLS_REPO_URL;
    if (token && TOOLS_REPO_URL.startsWith('https://')) {
      authenticatedUrl = TOOLS_REPO_URL.replace('https://', `https://${token}@`);
    }

    if (fs.existsSync(LOCAL_STAGING_DIR)) {
      try {
        fs.rmSync(LOCAL_STAGING_DIR, { recursive: true, force: true });
      } catch (err) {}
    }

    exec(`git clone ${authenticatedUrl} ${LOCAL_STAGING_DIR}`, async (err) => {
      if (err) {
        const sanitizedErr = token ? err.message.replace(new RegExp(token, 'g'), '****') : err.message;
        logger.error(`[Tool Sync Daemon Error] Pull operations aborted: ${sanitizedErr}`);
        return;
      }

      try {
        const manifestIndexPath = path.join(LOCAL_STAGING_DIR, 'manifest.json');
        if (!fs.existsSync(manifestIndexPath)) return;

        const registryIndex = JSON.parse(fs.readFileSync(manifestIndexPath, 'utf-8'));
        
        // Filter elements explicitly based on your local system identity configs
        const applicableTools = registryIndex.tools.filter(tool => 
          tool.target_machine_name === systemMachineName || (tool.compatibility_tags && tool.compatibility_tags.includes(process.arch))
        );

        if (!fs.existsSync(PRODUCTION_REGISTRY_DIR)) {
          fs.mkdirSync(PRODUCTION_REGISTRY_DIR, { recursive: true });
        }

        for (const targetTool of applicableTools) {
          const toolSourceDir = path.join(LOCAL_STAGING_DIR, 'tools', targetTool.name);
          const toolDestDir = path.join(PRODUCTION_REGISTRY_DIR, targetTool.name);

          if (fs.existsSync(toolSourceDir)) {
            if (fs.existsSync(toolDestDir)) {
              fs.rmSync(toolDestDir, { recursive: true, force: true });
            }
            fs.renameSync(toolSourceDir, toolDestDir);

            // Register/update the tool capability in sqlite DB
            await db.run(`
              INSERT INTO installed_tools (tool_name, version, manifest)
              VALUES (?, ?, ?)
              ON CONFLICT(tool_name) DO UPDATE SET version = excluded.version, manifest = excluded.manifest
            `, [targetTool.name, targetTool.version, JSON.stringify(targetTool)]);
          }
        }
        logger.info(`[Tool Sync Daemon Success] Node tools array synchronized for host machine profile: ${systemMachineName}`);
      } catch (parseErr) {
        logger.error(`[Tool Sync Daemon Failure] Error handling file moves: ${parseErr.message}`);
      } finally {
        if (fs.existsSync(LOCAL_STAGING_DIR)) {
          try {
            fs.rmSync(LOCAL_STAGING_DIR, { recursive: true, force: true });
          } catch (err) {}
        }
      }
    });
  };

  // Run on system bootstrap sequence execution
  executeSyncPipeline();

  // Run scheduled 4-hour synchronization loops
  setInterval(executeSyncPipeline, 4 * 60 * 60 * 1000);
}


