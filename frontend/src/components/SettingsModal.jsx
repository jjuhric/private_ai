import React, { useEffect } from 'react';
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
  onFetchLocalModels
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isSettingsOpen) {
        setIsSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, setIsSettingsOpen]);

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
                model_name: isAlreadyLocal ? prev.model_name : (localModels.length > 0 ? localModels[0] : 'google/gemma-4-e4b')
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

              let defaultModel = 'gemini-1.5-flash';
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ margin: 0 }}>Local Model Name</label>
                  <span
                    role="button"
                    onClick={() => onFetchLocalModels && onFetchLocalModels(settings)}
                    style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 550 }}
                  >
                    ⚡ Scan Models
                  </span>
                </div>
                {localModels.length > 0 ? (
                  <select
                    className="form-control"
                    value={settings.model_name}
                    onChange={e => setSettings(prev => ({ ...prev, model_name: e.target.value }))}
                  >
                    {localModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. google/gemma-4-e4b"
                    value={settings.model_name}
                    onChange={e => setSettings(prev => ({ ...prev, model_name: e.target.value }))}
                  />
                )}
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

                    let nextModel = 'gemini-1.5-flash';
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
                      return ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'];
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
