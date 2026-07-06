import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export default function LMStudioLogsView({ token }) {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [filter, setFilter] = useState('all'); // 'all', 'server', 'model'
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleClearLogs = () => {
    setShowConfirmModal(true);
  };

  const triggerClearLogs = async () => {
    try {
      const res = await fetch('/api/lmstudio/clear-logs', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setLogs([]);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to clear logs.');
      }
    } catch (err) {
      alert(`Error clearing logs: ${err.message}`);
    }
  };

  useEffect(() => {
    let url = `/api/lmstudio/log-stream?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setStatus('connected');
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'system', text: 'Live log stream connection established.' }]);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        let logText = data.message;
        let logType = data.type; // 'log', 'stderr', 'error'
        let parsedMessage = null;

        try {
          parsedMessage = JSON.parse(logText);
        } catch (e) {
          // message is raw text
        }

        setLogs(prev => {
          const newLogs = [...prev, {
            time: new Date().toLocaleTimeString(),
            type: logType,
            rawText: logText,
            parsed: parsedMessage
          }];
          return newLogs.slice(-400); // cap at 400 lines
        });
      } catch (err) {
        console.error('Failed to parse SSE message:', err);
      }
    };

    eventSource.onerror = () => {
      setStatus('disconnected');
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'error', text: 'Connection lost. Reconnecting...' }]);
    };

    return () => {
      eventSource.close();
    };
  }, [token]);

  // Filter logs
  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    if (log.parsed) {
      return log.parsed.source === filter;
    }
    return false;
  });

  // Automatically scroll to bottom of logs
  const terminalEndRef = React.useRef(null);
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredLogs]);

  return (
    <div className="card" style={{ background: 'rgba(10, 15, 30, 0.7)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', height: '600px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: status === 'connected' ? '#10b981' : '#f59e0b', display: 'inline-block' }}></span>
            LM Studio Log Stream
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Status: {status} (CLI output captures)
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {['all', 'server', 'model'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                border: 'none',
                color: '#fff',
                fontSize: '0.75rem',
                padding: '4px 10px',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              {f.toUpperCase()}
            </button>
          ))}
          <button
            onClick={handleClearLogs}
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#fca5a5',
              fontSize: '0.75rem',
              padding: '4px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              marginLeft: '8px'
            }}
          >
            Clear Logs
          </button>
        </div>
      </div>

      <div style={{
        flexGrow: 1,
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '8px',
        padding: '16px',
        fontFamily: 'monospace',
        fontSize: '0.85rem',
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }}>
        {filteredLogs.map((log, idx) => {
          if (log.type === 'system') {
            return (
              <div key={idx} style={{ color: '#60a5fa' }}>
                [{log.time}] SYSTEM: {log.text}
              </div>
            );
          }
          if (log.type === 'error') {
            return (
              <div key={idx} style={{ color: '#f87171' }}>
                [{log.time}] ERROR: {log.text || log.rawText}
              </div>
            );
          }
          if (log.type === 'stderr') {
            return (
              <div key={idx} style={{ color: '#fb923c' }}>
                [{log.time}] STDERR: {log.rawText}
              </div>
            );
          }

          // Parse and render formatted json log from lms
          if (log.parsed) {
            const p = log.parsed;
            const levelColor = p.level === 'error' ? '#f87171' : p.level === 'warning' ? '#fb923c' : '#34d399';
            const sourceColor = p.source === 'model' ? '#a78bfa' : '#60a5fa';
            return (
              <div key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '2px' }}>
                <span style={{ color: '#6b7280' }}>[{log.time}]</span>{' '}
                <span style={{ color: sourceColor }}>[{p.source || 'server'}]</span>{' '}
                <span style={{ color: levelColor }}>{p.level?.toUpperCase() || 'INFO'}:</span>{' '}
                <span style={{ color: '#e2e8f0' }}>{p.message}</span>
                {p.stats && (
                  <span style={{ color: '#a7f3d0', marginLeft: '8px', fontSize: '0.75rem' }}>
                    ({JSON.stringify(p.stats)})
                  </span>
                )}
              </div>
            );
          }

          return (
            <div key={idx}>
              <span style={{ color: '#6b7280' }}>[{log.time}]</span> {log.rawText}
            </div>
          );
        })}
        <div ref={terminalEndRef} />
      </div>
      {showConfirmModal && (
        <div className="modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, color: '#fff' }}>Private AI</h3>
              <button className="btn-icon" onClick={() => setShowConfirmModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                Are you sure you want to wipe the active LM Studio log file on disk?
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => setShowConfirmModal(false)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={() => {
                    setShowConfirmModal(false);
                    triggerClearLogs();
                  }}
                  style={{ flex: 1, background: '#ef4444', border: 'none' }}
                >
                  Clear Logs
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
