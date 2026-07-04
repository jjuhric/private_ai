require('dotenv').config();
const { getDb } = require('../db');
const { encrypt } = require('../utils/crypto');
const bcrypt = require('bcryptjs');

function parseArgs(argv) {
  const args = {};
  argv.slice(2).forEach(arg => {
    if (arg.startsWith('--')) {
      const parts = arg.slice(2).split('=');
      const key = parts[0];
      const val = parts.slice(1).join('=');
      args[key] = val;
    }
  });
  return args;
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const username = (args.username || 'admin').trim();
  const password = args.password || 'adminpassword';
  const deviceType = args.device_type || 'windows';
  const isMainHost = args.is_main_host === '1' || args.is_main_host === 'true' ? 1 : 0;
  
  const localUrl = args.local_url || process.env.LOCAL_LLM_URL || 'http://localhost:1234/v1';
  const localKey = args.local_key || process.env.LOCAL_LLM_KEY || null;
  const onlineProvider = args.online_provider || process.env.ONLINE_PROVIDER || 'gemini';
  const onlineKey = args.online_key || process.env.GEMINI_API_KEY || null;
  const githubToken = args.github_token || process.env.GITHUB_TOKEN || null;

  if (username.length === 0) {
    console.error('Error: Username cannot be empty.');
    process.exit(1);
    return;
  }
  if (password.length < 4) {
    console.error('Error: Password must be at least 4 characters long.');
    process.exit(1);
    return;
  }

  console.log(`Initializing SQLite database & seeding settings for user "${username}"...`);

  try {
    const db = await getDb();

    // Check if the user already exists
    const user = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    let userId;
    if (user) {
      userId = user.id;
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
      console.log(`User "${username}" (ID: ${userId}) updated successfully.`);
    } else {
      const res = await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
      userId = res.lastID;
      console.log(`Created new user "${username}" (ID: ${userId}).`);
    }

    // Encrypt keys
    const encryptedLocalKey = localKey ? encrypt(localKey) : null;
    const encryptedOnlineKey = onlineKey ? encrypt(onlineKey) : null;
    const encryptedGithubToken = githubToken ? encrypt(githubToken) : null;

    // Determine default provider
    const provider = onlineKey ? 'online' : 'local';
    
    // Determine default model names
    let modelName = process.env.PREFERRED_LOCAL_MODEL || 'qwen/qwen3.8-9b';
    if (provider === 'online') {
      if (onlineProvider === 'gemini') modelName = process.env.PREFERRED_ONLINE_MODEL || 'gemini-1.5-flash';
      else if (onlineProvider === 'openai') modelName = 'gpt-4o';
      else if (onlineProvider === 'anthropic') modelName = 'claude-3-5-sonnet-latest';
    }

    await db.run(`
      INSERT INTO user_settings (
        user_id, provider, model_name, github_token, local_key, 
        local_url, local_api_style, online_key, online_provider,
        preferred_local_model, preferred_online_model, supervisor_model,
        device_type, is_main_host
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        provider = excluded.provider,
        model_name = excluded.model_name,
        github_token = COALESCE(excluded.github_token, github_token),
        local_key = COALESCE(excluded.local_key, local_key),
        local_url = COALESCE(excluded.local_url, local_url),
        local_api_style = COALESCE(excluded.local_api_style, local_api_style),
        online_key = COALESCE(excluded.online_key, online_key),
        online_provider = COALESCE(excluded.online_provider, online_provider),
        preferred_local_model = COALESCE(excluded.preferred_local_model, preferred_local_model),
        preferred_online_model = COALESCE(excluded.preferred_online_model, preferred_online_model),
        supervisor_model = COALESCE(excluded.supervisor_model, supervisor_model),
        device_type = excluded.device_type,
        is_main_host = excluded.is_main_host
    `, [
      userId,
      provider,
      modelName,
      encryptedGithubToken,
      encryptedLocalKey,
      localUrl,
      args.local_api_style || ((localUrl.includes(':1234') || (localKey && localKey.startsWith('lm-'))) ? 'lm-studio' : 'openai'),
      encryptedOnlineKey,
      onlineProvider,
      args.preferred_local_model || process.env.PREFERRED_LOCAL_MODEL || 'qwen/qwen3.8-9b',
      args.preferred_online_model || process.env.PREFERRED_ONLINE_MODEL || 'gemini-1.5-flash',
      args.supervisor_model || process.env.SUPERVISOR_MODEL || (onlineProvider === 'gemini' ? 'gemini-1.5-pro' : 'gpt-4o'),
      deviceType,
      isMainHost
    ]);

    console.log('User settings initialized and seeded successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Fatal: Failed to seed settings database:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
