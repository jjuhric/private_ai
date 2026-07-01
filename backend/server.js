require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');

// Import modular routers
const authRouter = require('./routes/auth');
const profileRouter = require('./routes/profile');
const settingsRouter = require('./routes/settings');
const calendarRouter = require('./routes/calendar');
const chatRouter = require('./routes/chat');
const memoryRouter = require('./routes/memory');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize database connection and schedule daily memory maintenance
getDb().then(async (db) => {
  console.log('Database initialized successfully.');
  try {
    const { runDailyMemoryCheck } = require('./tools/memory_tool');
    await runDailyMemoryCheck(db);
    
    // Set 24 hour interval check
    setInterval(async () => {
      await runDailyMemoryCheck(db);
    }, 24 * 60 * 60 * 1000);
  } catch (err) {
    console.error('Error starting daily memory maintenance check:', err);
  }
}).catch(err => {
  console.error('Fatal: Database failed to initialize:', err);
  process.exit(1);
});

// Mount modular routes
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/memories', memoryRouter);
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
app.listen(PORT, () => {
  console.log(`Express Backend running securely on port ${PORT}`);
});
