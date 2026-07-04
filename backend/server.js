require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');

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
