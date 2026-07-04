const { handleWeatherTool } = require('../tools/weather_tool');
const { handleGoogleNewsTool } = require('../ai');
const { runWorkerAgent } = require('./agents');
const { decrypt } = require('./crypto');

async function generateDailyBriefing(db, userId) {
  try {
    // 1. Fetch user profile
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return null;

    const settings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
    const activeSettings = settings || {};

    // 2. Fetch today's calendar events
    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const events = await db.all(
      `SELECT * FROM calendar_events 
       WHERE user_id = ? 
         AND (start_time LIKE ? OR start_time LIKE ?)`,
      [userId, `${todayStr}%`, `%${todayStr}%`]
    );
    const eventsText = events.length > 0 
      ? events.map(e => `- [${e.start_time}] ${e.title}: ${e.description || 'No desc'}`).join('\n')
      : 'No events scheduled for today.';

    // 3. Fetch weather (using mock fallback if weather api key is missing)
    let weatherText = 'Weather info unavailable. Please configure OpenWeatherMap API Key.';
    if (user.weather_api_key && user.zipcode) {
      try {
        const decryptedKey = decrypt(user.weather_api_key);
        weatherText = await handleWeatherTool('current', {
          zipcode: user.zipcode,
          country: user.country || 'US',
          unit: user.temp_unit || 'imperial',
          apiKey: decryptedKey
        });
      } catch (err) {
        weatherText = `Error fetching weather: ${err.message}`;
      }
    }

    // 4. Fetch memories
    const memories = await db.all(
      `SELECT content FROM memories 
       WHERE user_id = ? 
         AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      [userId]
    );
    const memoriesText = memories.length > 0
      ? memories.map(m => `- ${m.content}`).join('\n')
      : 'No stored user memories found.';

    // 5. Fetch live Google News
    let newsText = 'No news updates retrieved today.';
    try {
      newsText = await handleGoogleNewsTool('top general headlines');
    } catch (err) {
      newsText = `News retrieval offline: ${err.message}`;
    }

    // 6. Invoke LLM to generate markdown digest
    const systemPrompt = `You are the Daily Briefing Assistant. Your task is to generate a beautiful, personalized, daily markdown digest for ${user.name || user.username}.
Compile the weather forecast, calendar schedule, relevant memories, and news headlines into a clean, encouraging briefing.
Add a friendly greeting and a daily quote/encouragement based on the user's memories and interests. Use rich markdown layout with emoji headings.`;

    const userPrompt = `
### Today's Date: ${todayStr}

### User Profile:
- Name: ${user.name || user.username}
- Temp Unit: ${user.temp_unit || 'imperial'}

### Weather Forecast:
${weatherText}

### Today's Schedule:
${eventsText}

### User Preferences/Memories:
${memoriesText}

### Today's News Headlines:
${newsText}

Generate the daily briefing now. Keep it professional, highly structured, and warm.
`;

    // Construct LLM configuration settings
    const llmSettings = {
      provider: activeSettings.provider || 'local',
      modelName: activeSettings.model_name || 'google/gemma-4-e4b',
      onlineProvider: activeSettings.online_provider || 'gemini',
      onlineKey: decrypt(activeSettings.online_key),
      geminiKey: decrypt(activeSettings.gemini_key),
      localBaseUrl: activeSettings.local_url || 'http://localhost:1234/v1',
      localApiKey: decrypt(activeSettings.local_key),
      localApiStyle: activeSettings.local_api_style || 'openai',
      onlineUrl: activeSettings.online_url
    };

    // Use supervisor model if override is present
    if (activeSettings.supervisor_model) {
      llmSettings.modelName = activeSettings.supervisor_model;
    }

    const aiResponse = await runWorkerAgent(
      'daily_briefing',
      systemPrompt,
      llmSettings,
      userPrompt
    );

    const briefingContent = aiResponse.thought || aiResponse.response || String(aiResponse);

    // 7. Find or create "Daily Briefings" chat
    let chat = await db.get('SELECT * FROM chats WHERE user_id = ? AND title = ?', [userId, 'Daily Briefings']);
    if (!chat) {
      const result = await db.run('INSERT INTO chats (user_id, title) VALUES (?, ?)', [userId, 'Daily Briefings']);
      chat = { id: result.lastID, title: 'Daily Briefings' };
    }

    // 8. Insert briefing into messages table
    await db.run(
      'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
      [chat.id, 'assistant', briefingContent]
    );

    // 9. Update last_briefing_at
    await db.run('UPDATE users SET last_briefing_at = datetime(\'now\') WHERE id = ?', [userId]);

    return briefingContent;
  } catch (err) {
    console.error('Error compiling daily briefing:', err);
    throw err;
  }
}

// Background scheduler checker
function startBriefingScheduler(db) {
  // Check every 5 minutes
  setInterval(async () => {
    try {
      const currentHour = new Date().getHours();
      // Find users who haven't had a briefing today, or never had one, and current time >= briefing_hour
      const users = await db.all(
        `SELECT * FROM users 
         WHERE (last_briefing_at IS NULL OR date(last_briefing_at) < date('now'))
           AND ? >= briefing_hour`,
        [currentHour]
      );

      for (const user of users) {
        console.log(`Triggering daily briefing schedule for user: ${user.username}`);
        await generateDailyBriefing(db, user.id);
      }
    } catch (err) {
      console.error('Briefing scheduler checking loop encountered error:', err);
    }
  }, 300000); // 5 minutes
}

module.exports = {
  generateDailyBriefing,
  startBriefingScheduler
};
