const fs = require('fs');
const path = require('path');
const dbModule = require('../db');

describe('Database Migration Tests', () => {
  const testDbPath = path.join(__dirname, 'migration_test.db');

  beforeEach(() => {
    // Clear connection and delete old test file
    jest.resetModules();
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (e) {}
    }
    process.env.DB_PATH = testDbPath;
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (e) {}
    }
  });

  test('should initialize a new database and apply migrations', async () => {
    const { getDb } = require('../db');
    const db = await getDb();
    expect(db).toBeDefined();

    // The second getDb call should return the existing connection
    const db2 = await getDb();
    expect(db2).toBe(db);

    await db.close();
  });

  test('should trigger migrations when columns are missing', async () => {
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');

    // Create a bare minimum DB manually first without the new columns
    const db = await open({
      filename: testDbPath,
      driver: sqlite3.Database
    });

    // Create minimal schema manually
    await db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE user_settings (id INTEGER PRIMARY KEY, model_name TEXT, preferred_online_model TEXT);
      CREATE TABLE memories (id INTEGER PRIMARY KEY);
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

    await migratedDb.close();
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
