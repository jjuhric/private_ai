const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');

let dbConnection = null;

async function getDb() {
  if (dbConnection) return dbConnection;

  const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.db');
  
  // Ensure database directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dbConnection = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await dbConnection.run('PRAGMA foreign_keys = ON');

  // Enable WAL (Write-Ahead Logging) mode and busy timeout for concurrent request handling
  await dbConnection.run('PRAGMA journal_mode = WAL');
  await dbConnection.run('PRAGMA busy_timeout = 5000');

  // Load schema
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await dbConnection.exec(schemaSql);

    // Check if the 'email' column exists in 'users' table, and add it if missing (for legacy databases)
    const columns = await dbConnection.all('PRAGMA table_info(users)');
    const hasEmail = columns.some(col => col.name === 'email');
    if (!hasEmail) {
      await dbConnection.run('ALTER TABLE users ADD COLUMN email TEXT');
    }
    if (!columns.some(col => col.name === 'name')) {
      await dbConnection.run('ALTER TABLE users ADD COLUMN name TEXT');
    }
    if (!columns.some(col => col.name === 'zipcode')) {
      await dbConnection.run('ALTER TABLE users ADD COLUMN zipcode TEXT');
    }
    if (!columns.some(col => col.name === 'temp_unit')) {
      await dbConnection.run("ALTER TABLE users ADD COLUMN temp_unit TEXT DEFAULT 'imperial'");
    }
    if (!columns.some(col => col.name === 'weather_api_key')) {
      await dbConnection.run('ALTER TABLE users ADD COLUMN weather_api_key TEXT');
    }
    if (!columns.some(col => col.name === 'country')) {
      await dbConnection.run("ALTER TABLE users ADD COLUMN country TEXT DEFAULT 'US'");
    }
    if (!columns.some(col => col.name === 'last_briefing_at')) {
      await dbConnection.run("ALTER TABLE users ADD COLUMN last_briefing_at DATETIME");
    }
    if (!columns.some(col => col.name === 'briefing_hour')) {
      await dbConnection.run("ALTER TABLE users ADD COLUMN briefing_hour INTEGER DEFAULT 7");
    }

    // Migrate user_settings to add local_key column if missing
    const settingsColumns = await dbConnection.all('PRAGMA table_info(user_settings)');
    const hasLocalKey = settingsColumns.some(col => col.name === 'local_key');
    if (!hasLocalKey) {
      await dbConnection.run('ALTER TABLE user_settings ADD COLUMN local_key TEXT');
    }
    
    if (!settingsColumns.some(col => col.name === 'local_url')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN local_url TEXT DEFAULT 'http://localhost:1234/v1'");
    }
    if (!settingsColumns.some(col => col.name === 'local_api_style')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN local_api_style TEXT DEFAULT 'openai'");
    }
    if (!settingsColumns.some(col => col.name === 'online_url')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN online_url TEXT");
    }
    if (!settingsColumns.some(col => col.name === 'online_key')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN online_key TEXT");
    }
    if (!settingsColumns.some(col => col.name === 'online_provider')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN online_provider TEXT DEFAULT 'gemini'");
    }
    if (!settingsColumns.some(col => col.name === 'preferred_local_model')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN preferred_local_model TEXT");
    }
    if (!settingsColumns.some(col => col.name === 'preferred_online_model')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN preferred_online_model TEXT");
    }
    if (!settingsColumns.some(col => col.name === 'supervisor_model')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN supervisor_model TEXT");
    }
    if (!settingsColumns.some(col => col.name === 'device_type')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN device_type TEXT DEFAULT 'windows'");
    }
    if (!settingsColumns.some(col => col.name === 'is_main_host')) {
      await dbConnection.run("ALTER TABLE user_settings ADD COLUMN is_main_host INTEGER DEFAULT 0");
    }

    // Migrate memories to add embedding column if missing
    const memoriesColumns = await dbConnection.all('PRAGMA table_info(memories)');
    const hasEmbedding = memoriesColumns.some(col => col.name === 'embedding');
    if (!hasEmbedding) {
      await dbConnection.run('ALTER TABLE memories ADD COLUMN embedding TEXT');
    }
    const hasAgentName = memoriesColumns.some(col => col.name === 'agent_name');
    if (!hasAgentName) {
      await dbConnection.run('ALTER TABLE memories ADD COLUMN agent_name TEXT');
    }
    
    // Migrate deprecated gemini-1.5-flash model names to gemini-2.0-flash
    await dbConnection.run(`
      UPDATE user_settings
      SET model_name = 'gemini-2.0-flash'
      WHERE model_name = 'gemini-1.5-flash'
    `);
    await dbConnection.run(`
      UPDATE user_settings
      SET preferred_online_model = 'gemini-2.0-flash'
      WHERE preferred_online_model = 'gemini-1.5-flash'
    `);

    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }

  return dbConnection;
}

module.exports = { getDb };
