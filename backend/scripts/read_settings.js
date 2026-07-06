require('dotenv').config();
const { getDb } = require('../db');
const { decrypt } = require('../utils/crypto');

async function main() {
  try {
    const db = await getDb();
    
    // Attempt to read the first user registered in the database
    const user = await db.get('SELECT username FROM users ORDER BY id ASC LIMIT 1');
    
    // Attempt to read the settings record
    const settings = await db.get('SELECT * FROM user_settings ORDER BY id ASC LIMIT 1');
    
    if (!user && !settings) {
      console.log('{}');
      process.exit(0);
      return;
    }
    
    const result = {
      username: user ? user.username : 'admin',
      device_type: settings ? settings.device_type : 'windows',
      is_main_host: settings ? settings.is_main_host : 1,
      local_url: settings ? settings.local_url : 'http://192.168.1.42:1234/v1',
      local_key: (settings && settings.local_key) ? decrypt(settings.local_key) : '',
      online_provider: settings ? settings.online_provider : 'gemini',
      online_key: (settings && settings.online_key) ? decrypt(settings.online_key) : '',
      github_token: (settings && settings.github_token) ? decrypt(settings.github_token) : ''
    };
    
    console.log(JSON.stringify(result));
    process.exit(0);
    return;
  } catch (err) {
    // If the database has not been initialized yet, print empty JSON and exit status 0
    console.log('{}');
    process.exit(0);
    return;
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
