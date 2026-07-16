const fs = require('fs');
const path = require('path');
const dbModule = require('../db');

describe('Database Migration Tests', () => {
  const testDbPath = path.join(__dirname, 'migration_test.db');

  function cleanupDbFiles() {
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = testDbPath + suffix;
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {}
      }
    }
  }

  beforeEach(() => {
    // Clear connection and delete old test file + WAL/SHM journals
    cleanupDbFiles();
    process.env.DB_PATH = testDbPath;
  });

  afterEach(async () => {
    const { closeDb } = require('../db');
    await closeDb();
    cleanupDbFiles();
  });

  test('should initialize a new database and apply migrations', async () => {
    const { getDb, closeDb } = require('../db');
    const db = await getDb();
    expect(db).toBeDefined();

    const db2 = await getDb();
    expect(db2).toBe(db);

    await closeDb();
  });

  test('should trigger migrations when columns are missing', async () => {
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');

    // Create a bare minimum DB manually first without the new columns
    const db = await open({
      filename: testDbPath,
      driver: sqlite3.Database
    });

    // Create a legacy schema with basic columns but missing the newer
    // migration columns (local_key, embedding, etc.). Use user_id as
    // PK to match the real schema definition.
    await db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT);
      CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, provider TEXT, model_name TEXT, github_token TEXT, gemini_key TEXT);
      CREATE TABLE memories (id INTEGER PRIMARY KEY, user_id INTEGER, content TEXT, level TEXT, expires_at DATETIME);
    `);
    await db.close();

    // Now run getDb which will see the missing columns and run ALTER TABLEs
    const { getDb } = require('../db');
    const migratedDb = await getDb();
    expect(migratedDb).toBeDefined();

    // Verify columns were added
    const userCols = await migratedDb.all('PRAGMA table_info(users)');
    expect(userCols.some(c => c.name === 'email')).toBe(true);
    expect(userCols.some(c => c.name === 'name')).toBe(true);

    const settingCols = await migratedDb.all('PRAGMA table_info(user_settings)');
    expect(settingCols.some(c => c.name === 'local_key')).toBe(true);

    const memoryCols = await migratedDb.all('PRAGMA table_info(memories)');
    expect(memoryCols.some(c => c.name === 'embedding')).toBe(true);

    const { closeDb } = require('../db');
    await closeDb();
  });

  test('handles initialization errors', async () => {
    const fs = require('fs');
    const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      throw new Error('Schema read failure');
    });

    const { getDb } = require('../db');
    await expect(getDb()).rejects.toThrow('Schema read failure');

    readSpy.mockRestore();
  });
});
