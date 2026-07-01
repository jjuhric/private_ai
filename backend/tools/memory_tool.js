/**
 * Handles operations for the Memory tool.
 * 
 * @param {import('sqlite').Database} db The SQLite database instance.
 * @param {number} userId The user's ID.
 * @param {string} action The action to perform: 'remember', 'recall', 'forget'.
 * @param {object} params Parameters for the action.
 * @returns {Promise<string>} Text output to be sent to the AI agent.
 */
async function handleMemoryTool(db, userId, action, params = {}) {
  if (!db) {
    return 'Error: Database connection is not available.';
  }

  try {
    switch (action) {
      case 'remember': {
        const { content, level, expiresAt, days } = params;
        if (!content || typeof content !== 'string' || content.trim() === '') {
          return 'Error: "content" parameter is required and must be a non-empty string for the "remember" action.';
        }

        const cleanContent = content.trim();
        const memLevel = (level === 'short-term' || level === 'long-term') ? level : 'long-term';
        
        let finalExpiresAt = null;
        if (memLevel === 'short-term') {
          if (expiresAt) {
            const parsedDate = new Date(expiresAt);
            if (!isNaN(parsedDate.getTime())) {
              finalExpiresAt = parsedDate.toISOString();
            }
          }
          
          if (!finalExpiresAt && days && typeof days === 'number') {
            const date = new Date();
            date.setDate(date.getDate() + days);
            finalExpiresAt = date.toISOString();
          }

          if (!finalExpiresAt) {
            // Default to 30 days retention
            const date = new Date();
            date.setDate(date.getDate() + 30);
            finalExpiresAt = date.toISOString();
          }
        }

        // Check for existing active memory with the same content
        const existing = await db.get(
          'SELECT id, expires_at FROM memories WHERE user_id = ? AND LOWER(content) = LOWER(?) AND (expires_at IS NULL OR expires_at > datetime(\'now\'))',
          [userId, cleanContent]
        );

        if (existing) {
          return `Already remembered: "${cleanContent}" (Level: ${memLevel}, Memory ID: ${existing.id}${existing.expires_at ? `, Expires at: ${existing.expires_at}` : ''}).`;
        }

        const result = await db.run(
          'INSERT INTO memories (user_id, content, level, expires_at) VALUES (?, ?, ?, ?)',
          [userId, cleanContent, memLevel, finalExpiresAt]
        );

        return `Successfully remembered: "${cleanContent}" (Level: ${memLevel}, Memory ID: ${result.lastID}${finalExpiresAt ? `, Expires at: ${finalExpiresAt}` : ''}).`;
      }

      case 'recall': {
        const { query } = params;
        
        let querySql = 'SELECT id, content, level, expires_at FROM memories WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime(\'now\'))';
        const queryParams = [userId];

        if (query && typeof query === 'string' && query.trim() !== '') {
          querySql += ' AND content LIKE ?';
          queryParams.push(`%${query.trim()}%`);
        }

        querySql += ' ORDER BY created_at DESC';
        const rows = await db.all(querySql, queryParams);

        if (rows.length === 0) {
          if (query) {
            // Fallback: search for any active memories if search query yielded nothing
            const allActive = await db.all(
              'SELECT id, content, level, expires_at FROM memories WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime(\'now\')) ORDER BY created_at DESC LIMIT 5',
              [userId]
            );
            if (allActive.length > 0) {
              return `No memories matched your search for "${query}". Here are the most recent general memories:\n` +
                allActive.map(r => `- [ID ${r.id}] ${r.content} (${r.level}${r.expires_at ? `, expires: ${r.expires_at}` : ''})`).join('\n');
            }
          }
          return 'No active memories found.';
        }

        return `Retrieved memories:\n` +
          rows.map(r => `- [ID ${r.id}] ${r.content} (${r.level}${r.expires_at ? `, expires: ${r.expires_at}` : ''})`).join('\n');
      }

      case 'forget': {
        const { memoryId } = params;
        if (!memoryId) {
          return 'Error: "memoryId" parameter is required for the "forget" action.';
        }

        const result = await db.run(
          'DELETE FROM memories WHERE id = ? AND user_id = ?',
          [memoryId, userId]
        );

        if (result.changes === 0) {
          return `No memory found with ID ${memoryId} for this user.`;
        }

        return `Successfully forgotten memory ID ${memoryId}.`;
      }

      default:
        return `Error: Unknown memory action "${action}". Supported actions are: 'remember', 'recall', 'forget'.`;
    }
  } catch (err) {
    console.error('Memory tool error:', err);
    return `Error performing memory action: ${err.message}`;
  }
}

/**
 * Searches memories for important events/reminders matching today's date, 
 * deletes expired ones, and automatically registers calendar entries.
 *
 * @param {import('sqlite').Database} db SQLite database instance.
 */
async function runDailyMemoryCheck(db) {
  if (!db) return;

  try {
    // 1. Delete expired memories
    const deleteResult = await db.run('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at <= datetime(\'now\')');
    if (deleteResult.changes > 0) {
      console.log(`Cleaned up ${deleteResult.changes} expired memories.`);
    }

    // 2. Fetch active memories to scan for today's reminders
    const activeMemories = await db.all(
      'SELECT id, user_id, content FROM memories WHERE expires_at IS NULL OR expires_at > datetime(\'now\')'
    );

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const todayISO = `${yyyy}-${mm}-${dd}`;

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthName = monthNames[now.getMonth()];
    const todayVerbal = `${monthName} ${now.getDate()}`;
    const todayVerbalFull = `${monthName} ${now.getDate()}, ${yyyy}`;

    for (const mem of activeMemories) {
      const contentLower = mem.content.toLowerCase();
      const matchISO = contentLower.includes(todayISO);
      const matchVerbal = contentLower.includes(todayVerbal.toLowerCase());
      const matchVerbalFull = contentLower.includes(todayVerbalFull.toLowerCase());

      if (matchISO || matchVerbal || matchVerbalFull) {
        const title = `Reminder: ${mem.content}`;
        const startTime = `${todayISO} 09:00`;
        const endTime = `${todayISO} 10:00`;

        const existing = await db.get(
          'SELECT id FROM calendar_events WHERE user_id = ? AND title = ? AND start_time = ?',
          [mem.user_id, title, startTime]
        );

        if (!existing) {
          await db.run(
            'INSERT INTO calendar_events (user_id, title, start_time, end_time, description) VALUES (?, ?, ?, ?, ?)',
            [mem.user_id, title, startTime, endTime, 'Automatically scheduled from AI Memory Vault']
          );
          console.log(`Auto-scheduled calendar reminder event for memory: "${mem.content}"`);
        }
      }
    }
  } catch (err) {
    console.error('Error running daily memory check:', err);
  }
}

module.exports = { handleMemoryTool, runDailyMemoryCheck };
