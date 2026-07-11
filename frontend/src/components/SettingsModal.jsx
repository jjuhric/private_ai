import React, { useEffect, useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';

export default function SettingsModal({
  isSettingsOpen,
  setIsSettingsOpen,
  settings,
  setSettings,
  localModels,
  onlineModels,
  saveSettings,
  showLocalKey,
  setShowLocalKey,
  showOnlineKey,
  setShowOnlineKey,
  showGithubToken,
  setShowGithubToken,
  onFetchLocalModels,
  currentUser,
  token
}) {
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminError, setAdminError] = useState('');
  const [adminSuccess, setAdminSuccess] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState([]);
  const [scanError, setScanError] = useState('');

  const handleScanSpeakers = async () => {
    setIsScanning(true);
    setScanError('');
    try {
      const res = await fetch('/api/settings/google-home/scan', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setScanResults(data);
      } else {
        setScanError('Failed to scan for speakers.');
      }
    } catch (err) {
      setScanError(err.message);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isSettingsOpen) {
        setIsSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, setIsSettingsOpen]);

  useEffect(() => {
    if (isSettingsOpen && currentUser && currentUser.username === 'admin') {
      fetchAdminUsers();
    }
  }, [isSettingsOpen, currentUser]);

  const fetchAdminUsers = async () => {
    try {
      const res = await fetch('/api/settings/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAdminUsers(data);
      } else {
        const errData = await res.json();
        setAdminError(errData.error || 'Failed to fetch users.');
      }
    } catch (err) {
      setAdminError(err.message);
    }
  };

  const handleUpdateQuota = async (userId, newQuota) => {
    setAdminError('');
    setAdminSuccess('');
    try {
      const res = await fetch(`/api/settings/admin/users/${userId}/quota`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ token_quota: parseInt(newQuota, 10) })
      });
      if (res.ok) {
        setAdminSuccess('Quota updated successfully.');
        fetchAdminUsers();
      } else {
        const errData = await res.json();
        setAdminError(errData.error || 'Failed to update quota.');
      }
    } catch (err) {
      setAdminError(err.message);
    }
  };

  if (!isSettingsOpen) return null;

  return (
    <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Assistant Settings</h3>
          <button className="btn-icon" onClick={() => setIsSettingsOpen(false)} aria-label="Close settings modal">
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: 20, borderBottom: '1px solid var(--border-glass)' }}>
          <button
            className={`settings-tab-btn ${settings.provider === 'local' ? 'active' : ''}`}
            onClick={() => {
              const isAlreadyLocal = localModels.includes(settings.model_name);
              setSettings(prev => ({
                ...prev,
                provider: 'local',
                model_name: isAlreadyLocal ? prev.model_name : (localModels.length > 0 ? localModels[0] : 'qwen2.5-coder-3b-instruct')
              }));
            }}
          >
            Local LLM
          </button>
          <button
            className={`settings-tab-btn ${settings.provider === 'gemini' ? 'active' : ''}`}
            onClick={() => {
              const currentOnlineProvider = settings.online_provider || 'gemini';
              const looksLikeGemini = onlineModels.some(m => m.includes('gemini'));
              const looksLikeOpenAI = onlineModels.some(m => m.includes('gpt') || m.includes('o1'));
              const looksLikeAnthropic = onlineModels.some(m => m.includes('claude'));

              let isValidOnlineModel = false;
              if (currentOnlineProvider === 'gemini' && looksLikeGemini && onlineModels.includes(settings.model_name)) isValidOnlineModel = true;
              if (currentOnlineProvider === 'openai' && looksLikeOpenAI && onlineModels.includes(settings.model_name)) isValidOnlineModel = true;
              if (currentOnlineProvider === 'anthropic' && looksLikeAnthropic && onlineModels.includes(settings.model_name)) isValidOnlineModel = true;

              let defaultModel = 'gemini-2.0-flash';
              if (currentOnlineProvider === 'openai') defaultModel = 'gpt-4o';
              else if (currentOnlineProvider === 'anthropic') defaultModel = 'claude-3-5-sonnet-latest';

              if (onlineModels.length > 0) {
                if (currentOnlineProvider === 'gemini' && looksLikeGemini) defaultModel = onlineModels[0];
                else if (currentOnlineProvider === 'openai' && looksLikeOpenAI) defaultModel = onlineModels[0];
                else if (currentOnlineProvider === 'anthropic' && looksLikeAnthropic) defaultModel = onlineModels[0];
              }

              setSettings(prev => ({
                ...prev,
                provider: 'gemini',
                model_name: isValidOnlineModel ? prev.model_name : defaultModel
              }));
            }}
            style={{ display: 'none' }}
          >
            Online Gemini
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {settings.provider === 'local' ? (
            <>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Local API Style</label>
                <select
                  className="form-control"
                  value={settings.local_api_style || 'openai'}
                  onChange={e => setSettings(prev => ({ ...prev, local_api_style: e.target.value }))}
                >
                  <option value="openai">OpenAI-compatible</option>
                  <option value="lm-studio">LM Studio API</option>
                  <option value="anthropic">Anthropic-compatible</option>
                  <option value="local-gemini">Gemini Local Style</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Local LLM Base URL</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. http://192.168.1.42:1234/v1"
                  value={settings.local_url || ''}
                  onChange={e => setSettings(prev => ({ ...prev, local_url: e.target.value }))}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'block', marginBottom: '6px' }}>Local Model Name</label>
                <input
                  type="text"
                  className="form-control"
                  value="qwen2.5-coder-3b-instruct"
                  disabled
                  readOnly
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Local LLM API Key (Token)</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showLocalKey ? 'text' : 'password'}
                    className="form-control"
                    style={{ paddingRight: '40px' }}
                    placeholder="Enter local API token if required"
                    value={settings.local_key || ''}
                    onChange={e => setSettings(prev => ({ ...prev, local_key: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowLocalKey(!showLocalKey)}
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
                    {showLocalKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Online Provider</label>
                <select
                  className="form-control"
                  value={settings.online_provider || 'gemini'}
                  onChange={e => {
                    const nextProvider = e.target.value;
                    const looksLikeGemini = onlineModels.some(m => m.includes('gemini'));
                    const looksLikeOpenAI = onlineModels.some(m => m.includes('gpt') || m.includes('o1'));
                    const looksLikeAnthropic = onlineModels.some(m => m.includes('claude'));

                    let nextModel = 'gemini-2.0-flash';
                    if (nextProvider === 'openai') nextModel = 'gpt-4o';
                    else if (nextProvider === 'anthropic') nextModel = 'claude-3-5-sonnet-latest';

                    if (onlineModels.length > 0) {
                      if (nextProvider === 'gemini' && looksLikeGemini) nextModel = onlineModels[0];
                      else if (nextProvider === 'openai' && looksLikeOpenAI) nextModel = onlineModels[0];
                      else if (nextProvider === 'anthropic' && looksLikeAnthropic) nextModel = onlineModels[0];
                    }

                    setSettings(prev => ({
                      ...prev,
                      online_provider: nextProvider,
                      model_name: nextModel
                    }));
                  }}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="custom">Custom API URL</option>
                </select>
              </div>
              {settings.online_provider !== 'gemini' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Online API Base URL</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. https://api.openai.com/v1"
                    value={settings.online_url || ''}
                    onChange={e => setSettings(prev => ({ ...prev, online_url: e.target.value }))}
                  />
                </div>
              )}
              <div className="form-group" style={{ margin: 0 }}>
                <label>Online Model Name</label>
                {(() => {
                  const getDisplayOnlineModels = () => {
                    const currentProvider = settings.online_provider || 'gemini';
                    if (onlineModels && onlineModels.length > 0) {
                      const looksLikeGemini = onlineModels.some(m => m.includes('gemini'));
                      const looksLikeOpenAI = onlineModels.some(m => m.includes('gpt') || m.includes('o1'));
                      const looksLikeAnthropic = onlineModels.some(m => m.includes('claude'));

                      if (currentProvider === 'gemini' && looksLikeGemini) return onlineModels;
                      if (currentProvider === 'openai' && looksLikeOpenAI) return onlineModels;
                      if (currentProvider === 'anthropic' && looksLikeAnthropic) return onlineModels;
                    }

                    if (currentProvider === 'gemini') {
                      return ['gemini-2.0-flash', 'gemini-1.5-pro'];
                    } else if (currentProvider === 'openai') {
                      return ['gpt-4o', 'gpt-4o-mini', 'o1-mini'];
                    } else if (currentProvider === 'anthropic') {
                      return ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'];
                    }
                    return [];
                  };

                  const displayModels = getDisplayOnlineModels();

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {displayModels.length > 0 ? (
                        <select
                          className="form-control"
                          value={settings.model_name}
                          onChange={e => setSettings(prev => ({ ...prev, model_name: e.target.value }))}
                        >
                          {displayModels.map(model => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Enter model name"
                          value={settings.model_name}
                          onChange={e => setSettings(prev => ({ ...prev, model_name: e.target.value }))}
                        />
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Online API Key</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showOnlineKey ? 'text' : 'password'}
                    className="form-control"
                    style={{ paddingRight: '40px' }}
                    placeholder="Enter provider API key"
                    value={settings.online_key || ''}
                    onChange={e => setSettings(prev => ({ ...prev, online_key: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowOnlineKey(!showOnlineKey)}
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
                    {showOnlineKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </>
          )}

          <div style={{ borderTop: '1px solid var(--border-glass)', padding: '16px 0 0 0', marginTop: 8 }}>
            <h4 style={{ marginBottom: 12, fontSize: '0.95rem' }}>GitHub Integration</h4>
            <div className="form-group" style={{ margin: 0 }}>
              <label>GitHub Personal Access Token (PAT)</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showGithubToken ? 'text' : 'password'}
                  className="form-control"
                  style={{ paddingRight: '40px' }}
                  placeholder="ghp_..."
                  value={settings.github_token}
                  onChange={e => setSettings(prev => ({ ...prev, github_token: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setShowGithubToken(!showGithubToken)}
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
                  {showGithubToken ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-glass)', padding: '16px 0 0 0', marginTop: 8 }}>
            <h4 style={{ marginBottom: 12, fontSize: '0.95rem' }}>Google Home Smart Speaker</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4 }}>Speaker Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Office Speaker"
                    value={settings.google_home_name || ''}
                    onChange={e => setSettings(prev => ({ ...prev, google_home_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4 }}>Speaker IP Address</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. 192.168.1.60"
                    value={settings.google_home_ip || ''}
                    onChange={e => setSettings(prev => ({ ...prev, google_home_ip: e.target.value }))}
                  />
                </div>
              </div>

              <button
                type="button"
                className="btn-primary"
                style={{ width: '100%', height: '38px', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={handleScanSpeakers}
                disabled={isScanning}
              >
                {isScanning ? 'Scanning local network...' : 'Scan Local Network for Speakers'}
              </button>

              {scanError && <div style={{ color: 'var(--error)', fontSize: '0.8rem' }}>{scanError}</div>}

              {scanResults.length > 0 && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4 }}>Discovered Speakers (Select to Apply)</label>
                  <select
                    className="form-control"
                    onChange={e => {
                      const selected = scanResults.find(d => d.ip === e.target.value);
                      if (selected) {
                        setSettings(prev => ({
                          ...prev,
                          google_home_name: selected.name,
                          google_home_ip: selected.ip
                        }));
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>-- Select a Speaker --</option>
                    {scanResults.map(device => (
                      <option key={device.ip} value={device.ip}>{device.name} ({device.ip})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-glass)', padding: '16px 0 0 0', marginTop: 8 }}>
            <h4 style={{ marginBottom: 12, fontSize: '0.95rem' }}>Workspace Configuration</h4>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Working Directory</label>
              <input
                type="text"
                className="form-control"
                placeholder="Absolute path to workspace root"
                value={settings.working_directory || ''}
                onChange={e => setSettings(prev => ({ ...prev, working_directory: e.target.value }))}
              />
            </div>
          </div>

          {currentUser && currentUser.username === 'admin' && (
            <div style={{ borderTop: '1px solid var(--border-glass)', padding: '16px 0 0 0', marginTop: 16 }}>
              <h4 style={{ marginBottom: 12, fontSize: '0.95rem', color: 'var(--accent-primary)' }}>Admin User Quota Management</h4>
              {adminError && <div style={{ color: 'var(--error)', fontSize: '0.85rem', marginBottom: 8 }}>{adminError}</div>}
              {adminSuccess && <div style={{ color: 'var(--success)', fontSize: '0.85rem', marginBottom: 8 }}>{adminSuccess}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                {adminUsers.map(u => (
                  <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-glass)' }}>
                    <div>
                      <div style={{ fontWeight: 550, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{u.username} {u.name ? `(${u.name})` : ''}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>24h Usage: {u.total_used_24h.toLocaleString()} tokens</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="number"
                        className="form-control"
                        style={{ width: '110px', margin: 0, padding: '4px 8px', fontSize: '0.85rem', height: '32px' }}
                        defaultValue={u.token_quota}
                        id={`quota-input-${u.id}`}
                      />
                      <button
                        className="btn-primary"
                        style={{ padding: '0 12px', fontSize: '0.8rem', margin: 0, height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => {
                          const input = document.getElementById(`quota-input-${u.id}`);
                          if (input) {
                            handleUpdateQuota(u.id, input.value);
                          }
                        }}
                      >
                        Set
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            className="btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => saveSettings(settings)}
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
