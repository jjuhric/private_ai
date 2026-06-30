import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';

export default function ProfileModal({
  isProfileOpen,
  setIsProfileOpen,
  profile,
  saveProfile
}) {
  const [formData, setFormData] = useState({
    name: '',
    zipcode: '',
    country: 'US',
    temp_unit: 'imperial',
    weather_api_key: ''
  });
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name || '',
        zipcode: profile.zipcode || '',
        country: profile.country || 'US',
        temp_unit: profile.temp_unit || 'imperial',
        weather_api_key: profile.weather_api_key || ''
      });
    }
  }, [profile, isProfileOpen]);

  if (!isProfileOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    saveProfile(formData);
  };

  return (
    <div className="modal-overlay" onClick={() => setIsProfileOpen(false)}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>User Profile Settings</h3>
          <button className="btn-icon" onClick={() => setIsProfileOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Name</label>
            <input 
              type="text" 
              className="form-control" 
              placeholder="Your preferred name"
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Zipcode</label>
            <input 
              type="text" 
              className="form-control" 
              placeholder="e.g. 32421"
              value={formData.zipcode}
              onChange={e => setFormData(prev => ({ ...prev, zipcode: e.target.value }))}
            />
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Country Code (e.g. US, GB, CA, IT)</label>
            <input 
              type="text" 
              className="form-control" 
              placeholder="US"
              maxLength={3}
              value={formData.country}
              onChange={e => setFormData(prev => ({ ...prev, country: e.target.value.toUpperCase().trim() }))}
            />
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Temperature Units</label>
            <select 
              className="form-control"
              value={formData.temp_unit}
              onChange={e => setFormData(prev => ({ ...prev, temp_unit: e.target.value }))}
            >
              <option value="imperial">Imperial (°F, mph)</option>
              <option value="metric">Metric (°C, m/s)</option>
              <option value="standard">Standard (Kelvin, m/s)</option>
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>OpenWeatherMap API Key</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showApiKey ? 'text' : 'password'} 
                className="form-control" 
                style={{ paddingRight: '40px' }}
                placeholder="Enter OpenWeatherMap API key"
                value={formData.weather_api_key}
                onChange={e => setFormData(prev => ({ ...prev, weather_api_key: e.target.value }))}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0
                }}
              >
                {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
              Used to query weather for your local area. Get a key at <a href="https://openweathermap.org" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)' }}>openweathermap.org</a>.
            </small>
          </div>

          <button type="submit" className="btn-primary" style={{ marginTop: 8 }}>
            Save Profile
          </button>
        </form>
      </div>
    </div>
  );
}
