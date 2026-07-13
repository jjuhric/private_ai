import React, { useState, useEffect } from 'react';
import { X, Send, Cpu } from 'lucide-react';

export default function Esp32MessageModal({ isOpen, onClose, token, hostIps = [] }) {
  const defaultIps = ['192.168.1.117', '192.168.1.60', '192.168.1.199'];
  const [ips, setIps] = useState(defaultIps);
  const [selectedIp, setSelectedIp] = useState('192.168.1.117');
  const [deviceType, setDeviceType] = useState('ESP32');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleIpChange = (ip) => {
    setSelectedIp(ip);
    if (ip === '192.168.1.60' || ip === '192.168.1.199') {
      setDeviceType('Google Assistant');
    } else if (ip === '192.168.1.117') {
      setDeviceType('ESP32');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    // Reset state on open
    setMessage('');
    setError('');
    setSuccess('');
    setLoading(false);

    // Fetch registered nodes to populate IP list
    const fetchNodes = async () => {
      try {
        const res = await fetch('/api/nodes', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const filterHostIp = (ip) => {
          return hostIps.includes(ip) || ip === '127.0.0.1' || ip === 'localhost';
        };

        if (res.ok) {
          const data = await res.json();
          const registeredIps = data.map(node => node.ip_address);
          const uniqueIps = Array.from(new Set([...defaultIps, ...registeredIps]));
          setIps(uniqueIps.filter(ip => !filterHostIp(ip)));
        } else {
          setIps(defaultIps.filter(ip => !filterHostIp(ip)));
        }
      } catch (err) {
        console.error('Failed to fetch network nodes:', err);
        const filterHostIp = (ip) => {
          return hostIps.includes(ip) || ip === '127.0.0.1' || ip === 'localhost';
        };
        setIps(defaultIps.filter(ip => !filterHostIp(ip)));
      }
    };
    fetchNodes();
  }, [isOpen, token, hostIps]);

  if (!isOpen) return null;

  const isHostIp = (ip) => {
    return hostIps.includes(ip) || ip === '127.0.0.1' || ip === 'localhost';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (isHostIp(selectedIp)) {
      setError("Cannot send messages to the host's own IP address.");
      return;
    }

    if (message.length > 240) {
      const diff = message.length - 240;
      setError(`message exceeds max length 240 by ${diff} characters`);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/nodes/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ip_address: selectedIp,
          device_type: deviceType,
          message
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send message');
      }

      setSuccess('Message sent successfully!');
      setMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0, color: 'var(--accent-primary)' }}>
            <Cpu size={22} />
            <span>Send Device Message</span>
          </h3>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Select Device IP Address
            </label>
            <select
              className="form-control"
              value={selectedIp}
              onChange={e => handleIpChange(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border-glass)',
                color: '#fff',
                outline: 'none'
              }}
            >
              {ips.map(ip => {
                let label = ip;
                if (ip === '192.168.1.117') label = `${ip} (Default ESP32)`;
                else if (ip === '192.168.1.60') label = `${ip} (Living Room Nest Mini)`;
                else if (ip === '192.168.1.199') label = `${ip} (Bedroom Nest Mini)`;

                return (
                  <option 
                    key={ip} 
                    value={ip} 
                    style={{ 
                      background: '#0f172a',
                      color: '#fff'
                    }}
                  >
                    {label}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Device Type
            </label>
            <select
              className="form-control"
              value={deviceType}
              onChange={e => setDeviceType(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border-glass)',
                color: '#fff',
                outline: 'none'
              }}
            >
              <option value="ESP32" style={{ background: '#0f172a' }}>ESP32</option>
              <option value="RPi" style={{ background: '#0f172a' }}>RPi</option>
              <option value="Windows" style={{ background: '#0f172a' }}>Windows</option>
              <option value="Google Assistant" style={{ background: '#0f172a' }}>Google Assistant</option>
            </select>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <span>Enter Message</span>
              <span style={{ color: message.length > 240 ? '#ef4444' : 'var(--text-secondary)' }}>
                {message.length} / 240
              </span>
            </label>
            <textarea
              className="form-control"
              rows={4}
              placeholder="Type your message here..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border-glass)',
                color: '#fff',
                resize: 'vertical',
                outline: 'none'
              }}
              required
            />
          </div>

          {error && (
            <div style={{
              color: '#ef4444',
              fontSize: '0.85rem',
              background: 'rgba(239, 68, 68, 0.1)',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              overflowWrap: 'break-word',
              wordBreak: 'break-word'
            }}>
              ⚠️ {error}
            </div>
          )}

          {success && (
            <div style={{
              color: '#34d399',
              fontSize: '0.85rem',
              background: 'rgba(52, 211, 153, 0.1)',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(52, 211, 153, 0.2)'
            }}>
              ✓ {success}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !message.trim()}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <Send size={16} />
              <span>{loading ? 'Sending...' : 'Send Message'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
