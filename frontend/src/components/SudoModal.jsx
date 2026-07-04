import React, { useState } from 'react';
import { X, ShieldAlert } from 'lucide-react';

export default function SudoModal({ isOpen, onClose, onSubmit, command, settings }) {
  const [password, setPassword] = useState('');
  
  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(password);
    setPassword('');
  };

  const isWindowsUAC = settings?.device_type === 'windows';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ 
        maxWidth: '400px', 
        background: isWindowsUAC ? '#fff' : 'var(--bg-panel)',
        color: isWindowsUAC ? '#000' : '#fff'
      }}>
        <div className="modal-header" style={{ borderBottom: `1px solid ${isWindowsUAC ? '#ccc' : 'rgba(255,255,255,0.08)'}` }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isWindowsUAC ? '#003399' : '#ff6b6b', margin: 0, fontWeight: isWindowsUAC ? 'bold' : 'normal' }}>
            <ShieldAlert size={20} color={isWindowsUAC ? '#003399' : '#ff6b6b'} /> 
            {isWindowsUAC ? 'User Account Control' : 'Elevated Privileges Required'}
          </h3>
          <button className="btn-icon" onClick={onClose} style={{ color: isWindowsUAC ? '#000' : '#fff' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <p style={{ fontSize: '0.85rem', color: isWindowsUAC ? '#333' : 'var(--text-secondary)', margin: 0 }}>
            {isWindowsUAC 
              ? "Do you want to allow this app to make changes to your device? Please enter your Windows password to continue:"
              : "This command requires superuser permissions (`sudo`). Please enter your host system password to continue:"}
          </p>

          <div style={{
            background: isWindowsUAC ? '#f0f0f0' : 'rgba(0,0,0,0.2)',
            padding: '8px 12px',
            borderRadius: '6px',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            border: `1px solid ${isWindowsUAC ? '#ccc' : 'rgba(255,255,255,0.05)'}`,
            wordBreak: 'break-all',
            color: isWindowsUAC ? '#000' : '#fff'
          }}>
            {command}
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '6px', color: isWindowsUAC ? '#000' : 'rgba(255,255,255,0.7)' }}>
              Password
            </label>
            <input
              type="password"
              className="form-control"
              placeholder="Enter password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{
                background: isWindowsUAC ? '#fff' : undefined,
                color: isWindowsUAC ? '#000' : undefined,
                border: isWindowsUAC ? '1px solid #ccc' : undefined
              }}
              required
              autoFocus
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button type="button" className={`btn ${isWindowsUAC ? '' : 'btn-secondary'}`} onClick={onClose} style={{ flex: 1, border: isWindowsUAC ? '1px solid #ccc' : '1px solid rgba(255,255,255,0.1)', background: isWindowsUAC ? '#e1e1e1' : undefined, color: isWindowsUAC ? '#000' : undefined }}>
              {isWindowsUAC ? 'No' : 'Cancel'}
            </button>
            <button type="submit" className={`btn ${isWindowsUAC ? '' : 'btn-primary'}`} style={{ flex: 1, background: isWindowsUAC ? '#0055cc' : undefined, color: isWindowsUAC ? '#fff' : undefined, border: 'none' }}>
              {isWindowsUAC ? 'Yes' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
