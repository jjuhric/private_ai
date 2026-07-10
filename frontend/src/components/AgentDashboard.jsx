import React from 'react';
import { Network } from 'lucide-react';

export default function AgentDashboard() {
  const token = localStorage.getItem('token') || '';
  const monitorDashboardUrl = `http://${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}/monitor/?token=${encodeURIComponent(token)}`;
  const displayAddress = `${window.location.host}/monitor`;

  return (
    <div className="memory-pane" style={{ padding: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-primary)' }}>
      <div className="memory-card" style={{ padding: '40px', maxWidth: '560px', textAlign: 'center', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', borderRadius: '24px', boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)' }}>
        <Network className="text-accent-primary" size={64} style={{ marginBottom: '24px', filter: 'drop-shadow(0 0 8px var(--accent-primary))' }} />
        <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '16px', background: 'linear-gradient(135deg, var(--text-primary) 30%, var(--accent-secondary) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Standalone Agent Monitor
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '32px' }}>
          The Live Agent & Concurrency Dashboard has been decoupled into a lightweight standalone monitor application. You can launch it on a dedicated display or secondary monitor for real-time edge telemetry and agent pipeline visibility.
        </p>
        <a 
          href={monitorDashboardUrl} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '12px 32px', fontSize: '1rem', textDecoration: 'none', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', borderRadius: '12px', color: '#fff', fontWeight: 600, boxShadow: '0 4px 15px rgba(139, 92, 246, 0.3)' }}
        >
          Launch Standalone Monitor
        </a>
        <div style={{ marginTop: '24px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Running on: <code style={{ color: 'var(--accent-secondary)' }}>{displayAddress}</code>
        </div>
      </div>
    </div>
  );
}
