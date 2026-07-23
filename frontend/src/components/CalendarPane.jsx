import React from 'react';
import { X } from 'lucide-react';

export default function CalendarPane({
  calendarEvents,
  calendarForm,
  setCalendarForm,
  calendarDate,
  setCalendarDate,
  handleAddCalendarEvent,
  handleDeleteCalendarEvent
}) {
  return (
    <div className="chat-pane" style={{ overflowY: 'auto' }}>
      <div className="calendar-layout">
        <div>
          <h3 style={{ marginBottom: 16 }}>Schedule for {calendarDate}</h3>
          <div style={{ display: 'flex', gap: '8px', marginBottom: 16 }}>
            <input 
              type="date" 
              className="form-control" 
              value={calendarDate}
              onChange={e => setCalendarDate(e.target.value)}
              style={{ maxWidth: 200 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {calendarEvents.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>No meetings or tasks scheduled for this day.</p>
            ) : (
              calendarEvents.map(event => (
                <div 
                  key={event.id} 
                  style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    border: '1px solid var(--border-glass)', 
                    padding: 16, 
                    borderRadius: 12, 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center' 
                  }}
                >
                  <div>
                    <h4 style={{ fontWeight: 650 }}>{event.title}</h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                      🕒 {event.start_time} - {event.end_time}
                    </p>
                    {event.description && (
                      <p style={{ fontSize: '0.9rem', marginTop: 8 }}>{event.description}</p>
                    )}
                  </div>
                  <button 
                    className="btn-icon" 
                    onClick={() => handleDeleteCalendarEvent(event.id)} 
                    style={{ color: '#ef4444' }}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Add schedule event */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', padding: 20, borderRadius: 16 }}>
          <h3 style={{ marginBottom: 16 }}>New Appointment</h3>
          <form onSubmit={handleAddCalendarEvent} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Title</label>
              <input 
                type="text" 
                className="form-control" 
                placeholder="e.g. Code Review" 
                value={calendarForm.title}
                onChange={e => setCalendarForm(p => ({ ...p, title: e.target.value }))}
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Start Time (YYYY-MM-DD HH:MM)</label>
              <input 
                type="text" 
                className="form-control" 
                placeholder="YYYY-MM-DD HH:MM" 
                value={calendarForm.start_time}
                onChange={e => setCalendarForm(p => ({ ...p, start_time: e.target.value }))}
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>End Time (YYYY-MM-DD HH:MM)</label>
              <input 
                type="text" 
                className="form-control" 
                placeholder="YYYY-MM-DD HH:MM" 
                value={calendarForm.end_time}
                onChange={e => setCalendarForm(p => ({ ...p, end_time: e.target.value }))}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Description</label>
              <textarea 
                className="form-control" 
                rows={3} 
                placeholder="Notes..." 
                value={calendarForm.description}
                onChange={e => setCalendarForm(p => ({ ...p, description: e.target.value }))}
              />
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%' }}>Add Event</button>
          </form>
        </div>
      </div>
    </div>
  );
}
