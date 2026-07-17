const { getDb } = require('../db');
const logger = require('../utils/logger');
const path = require('path');

// Set environment variable to make sure it loads the correct DB path if configured
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.db');

async function runCleanup() {
  try {
    const db = await getDb();
    logger.info('Starting database node duplicates cleanup...');

    // 1. Delete gateway/subnet IP 192.168.1.1
    const delGateway = await db.run("DELETE FROM network_nodes WHERE ip_address = '192.168.1.1'");
    logger.info(`Deleted gateway/subnet router nodes (192.168.1.1): ${delGateway.changes}`);

    // 2. Query all duplicate IPs and clean them up
    // We select all IDs we want to KEEP, and delete the rest.
    // For each IP address, we prioritize 'google_home' device_type, then the oldest record (lowest id).
    const keepIdsResult = await db.all(`
      SELECT id, ip_address, device_type FROM (
        SELECT id, ip_address, device_type,
               ROW_NUMBER() OVER (
                 PARTITION BY ip_address 
                 ORDER BY CASE WHEN device_type = 'google_home' THEN 0 ELSE 1 END, id ASC
               ) as rn
        FROM network_nodes
      ) WHERE rn = 1
    `);

    const keepIds = keepIdsResult.map(row => row.id);

    if (keepIds.length > 0) {
      const placeholders = keepIds.map(() => '?').join(',');
      const delDuplicates = await db.run(
        `DELETE FROM network_nodes WHERE id NOT IN (${placeholders})`,
        keepIds
      );
      logger.info(`Deleted duplicate network node entries: ${delDuplicates.changes}`);
    } else {
      logger.info('No nodes found to process.');
    }

    logger.info('Database cleanup complete.');
    process.exit(0);
  } catch (err) {
    logger.error(`Database cleanup failed: ${err.message}`);
    process.exit(1);
  }
}

runCleanup();
