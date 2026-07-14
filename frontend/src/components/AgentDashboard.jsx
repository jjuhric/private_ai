import React from 'react';
import { ExternalLink, Monitor, Network } from 'lucide-react';

export default function AgentDashboard() {
  const token = (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function')
    ? (localStorage.getItem('token') || '')
    : '';
  const monitorDashboardUrl = `http://${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}/monitor/?token=${encodeURIComponent(token)}`;
  const displayAddress = `${window.location.host}/monitor`;

  return (
    <div style={{
      padding: '40px 24px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      background: 'var(--bg-primary)',
      overflowY: 'auto'
    }}>
      <div style={{
        maxWidth: '640px',
        width: '100%',
        background: 'var(--bg-glass)',
        border: '1px solid var(--border-glass)',
        borderRadius: '24px',
        padding: '40px 32px',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.25)',
        backdropFilter: 'blur(16px)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px'
      }}>
        {/* Pulsing visual element */}
        <div style={{
          position: 'relative',
          width: '100px',
          height: '100px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.2) 0%, rgba(139, 92, 246, 0) 70%)',
          borderRadius: '50%'
        }}>
          <div style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            border: '2px solid var(--accent-primary)',
            borderRadius: '50%',
            animation: 'pulse-ring 2s cubic-bezier(0.215, 0.610, 0.355, 1) infinite',
            opacity: 0.7
          }} />
          <Monitor size={44} style={{ color: 'var(--accent-primary)', filter: 'drop-shadow(0 0 10px rgba(139, 92, 246, 0.6))' }} />
        </div>

        <div>
          <h2 style={{
            fontSize: '1.8rem',
            fontWeight: 800,
            marginBottom: '12px',
            color: 'var(--text-primary)',
            background: 'linear-gradient(135deg, #fff 30%, var(--accent-secondary) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Standalone Agent Monitor
          </h2>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '0.95rem',
            lineHeight: 1.6,
            margin: '0 auto',
            maxWidth: '500px'
          }}>
            The Live Agent & Concurrency Dashboard has been decoupled into a lightweight standalone monitor application. You can launch it on a dedicated display or secondary monitor for real-time edge telemetry and agent pipeline visibility.
          </p>
        </div>

        <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
          <a
            href={monitorDashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 28px',
              fontSize: '0.95rem',
              textDecoration: 'none',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              borderRadius: '12px',
              color: '#fff',
              fontWeight: 600,
              boxShadow: '0 4px 20px rgba(139, 92, 246, 0.35)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
          >
            <ExternalLink size={18} /> Launch Standalone Monitor
          </a>
        </div>

        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Running on: <code style={{ color: 'var(--accent-secondary)', padding: '2px 6px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>{displayAddress}</code>
        </div>
      </div>

      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.65); opacity: 0; }
          50% { opacity: 0.5; }
          100% { transform: scale(1.15); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
