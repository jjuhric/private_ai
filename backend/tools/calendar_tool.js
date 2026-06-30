// Calendar tool operations (SQLite-backed)
async function handleCalendarTool(db, userId, action, params) {
  if (action === 'list') {
    const { date } = params; // YYYY-MM-DD
    const queryDate = date || new Date().toISOString().split('T')[0];
    const events = await db.all(
      `SELECT * FROM calendar_events 
       WHERE user_id = ? AND (start_time LIKE ? OR date(start_time) = date(?))
       ORDER BY start_time ASC`,
      [userId, `${queryDate}%`, queryDate]
    );
    return JSON.stringify(events);
  } else if (action === 'add') {
    const { title, start_time, end_time, description } = params;
    if (!title || !start_time) {
      return JSON.stringify({ error: 'Title and start_time are required' });
    }
    const result = await db.run(
      `INSERT INTO calendar_events (user_id, title, description, start_time, end_time) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, title, description || '', start_time, end_time || start_time]
    );
    return JSON.stringify({ success: true, eventId: result.lastID, message: 'Event added successfully' });
  } else if (action === 'delete') {
    const { eventId } = params;
    if (!eventId) {
      return JSON.stringify({ error: 'eventId is required' });
    }
    await db.run(`DELETE FROM calendar_events WHERE id = ? AND user_id = ?`, [eventId, userId]);
    return JSON.stringify({ success: true, message: 'Event deleted successfully' });
  }
  return JSON.stringify({ error: 'Unknown calendar action' });
}

module.exports = { handleCalendarTool };
