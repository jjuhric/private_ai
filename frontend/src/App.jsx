import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, Plus, LogOut, Settings, Send, Calendar, 
  ChevronDown, ChevronUp, Github, Search, RefreshCw, X, Menu, Lock, User, PlusCircle, Check, Edit2, Eye, EyeOff
} from 'lucide-react';
import { marked } from 'marked';

// Configure marked options
marked.setOptions({
  breaks: true,
  gfm: true
});

function App() {
  // Auth state
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [isLogin, setIsLogin] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });

  // Navigation and panels
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'calendar'
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');

  // Settings
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({
    provider: 'local',
    model_name: 'google/gemma-4-e4b',
    github_token: '',
    local_key: '',
    local_url: 'http://192.168.1.42:1234/v1',
    local_api_style: 'openai',
    online_url: '',
    online_key: '',
    online_provider: 'gemini'
  });
  const [localModels, setLocalModels] = useState([]);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showLocalKey, setShowLocalKey] = useState(false);
  const [showOnlineKey, setShowOnlineKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);

  // Calendar
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarForm, setCalendarForm] = useState({ title: '', start_time: '', end_time: '', description: '' });
  const [calendarDate, setCalendarDate] = useState(new Date().toISOString().split('T')[0]);

  // Input & Streaming state
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamThoughts, setStreamThoughts] = useState('');
  const [streamContent, setStreamContent] = useState('');
  const [toolLogs, setToolLogs] = useState([]); // array of active/past tool calls

  const messagesEndRef = useRef(null);

  // Load user data & chats if token is present
  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      fetchUserProfile();
      fetchChats();
      fetchSettings();
      fetchCalendarEvents();
    } else {
      localStorage.removeItem('token');
      setUser(null);
    }
  }, [token]);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const res = await fetch('/api/version');
        if (res.ok) {
          const data = await res.json();
          setAppVersion(data.version);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchVersion();
  }, []);

  useEffect(() => {
    if (activeChatId) {
      fetchMessages(activeChatId);
    } else {
      setMessages([]);
    }
  }, [activeChatId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamContent, streamThoughts, toolLogs]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Auth operations
  const fetchUserProfile = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        handleLogout();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }
      if (isLogin) {
        setToken(data.token);
      } else {
        setIsLogin(true);
        setAuthForm({ username: '', password: '' });
        alert('Registration successful! Please log in.');
      }
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    setToken('');
    localStorage.removeItem('token');
  };

  // Chats operations
  const fetchChats = async () => {
    try {
      const res = await fetch('/api/chats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChats(data);
        if (data.length > 0 && !activeChatId) {
          setActiveChatId(data[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const createChat = async () => {
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: `Chat ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` })
      });
      if (res.ok) {
        const data = await res.json();
        setChats(prev => [data, ...prev]);
        setActiveChatId(data.chatId);
        setActiveTab('chat');
        setIsMobileSidebarOpen(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteChat = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this chat room?')) return;
    try {
      const res = await fetch(`/api/chats/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setChats(prev => prev.filter(c => c.id !== id));
        if (activeChatId === id) {
          setActiveChatId(null);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRenameChat = async (id, newTitle) => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch(`/api/chats/${id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle })
      });
      if (res.ok) {
        setChats(prev => prev.map(c => c.id === id ? { ...c, title: newTitle } : c));
        setEditingChatId(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMessages = async (chatId) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Settings operations
  const fetchLocalModels = async () => {
    try {
      const res = await fetch('/api/settings/local-models', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLocalModels(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({
          provider: data.provider || 'local',
          model_name: data.model_name || 'google/gemma-4-e4b',
          github_token: data.github_token || '',
          gemini_key: data.gemini_key || '',
          local_key: data.local_key || '',
          local_url: data.local_url || 'http://192.168.1.42:1234/v1',
          local_api_style: data.local_api_style || 'openai',
          online_url: data.online_url || '',
          online_key: data.online_key || '',
          online_provider: data.online_provider || 'gemini'
        });
      }
      fetchLocalModels();
    } catch (err) {
      console.error(err);
    }
  };

  const saveSettings = async (newSettings) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newSettings)
      });
      if (res.ok) {
        setSettings(newSettings);
        setIsSettingsOpen(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Calendar operations
  const fetchCalendarEvents = async () => {
    try {
      const res = await fetch(`/api/calendar?date=${calendarDate}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCalendarEvents(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (token) fetchCalendarEvents();
  }, [calendarDate]);

  const handleAddCalendarEvent = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(calendarForm)
      });
      if (res.ok) {
        setCalendarForm({ title: '', start_time: '', end_time: '', description: '' });
        fetchCalendarEvents();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCalendarEvent = async (id) => {
    try {
      const res = await fetch(`/api/calendar/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchCalendarEvents();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Chat Streaming Logic
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChatId || isStreaming) return;

    const currentMsg = inputText;
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', content: currentMsg }]);
    
    setIsStreaming(true);
    setStreamThoughts('');
    setStreamContent('');
    setToolLogs([]);

    let accumulatedRawContent = '';
    let coordinatorThoughts = '';

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ chatId: activeChatId, message: currentMsg })
      });

      if (!response.ok) {
        throw new Error('Streaming connection failed.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep last chunk

        for (const line of lines) {
          if (!line.trim()) continue;
          
          // Parse Server Sent Events format
          const matchEvent = line.match(/^event: (.+)$/m);
          const matchData = line.match(/^data: (.+)$/m);

          if (matchEvent && matchData) {
            const eventType = matchEvent[1];
            let dataValue = matchData[1];
            try {
              dataValue = JSON.parse(dataValue);
            } catch (e) {
              // text was not json
            }

            if (eventType === 'thought') {
              coordinatorThoughts += dataValue;
              setStreamThoughts(coordinatorThoughts);
            } else if (eventType === 'content') {
              accumulatedRawContent += dataValue;
              
              const startTagGemma = '<|channel>thought';
              const endTagGemma = '<channel|>';
              const startTagXml = '<think>';
              const endTagXml = '</think>';
              
              let currentStartTag = '';
              let currentEndTag = '';
              
              if (accumulatedRawContent.includes(startTagXml)) {
                currentStartTag = startTagXml;
                currentEndTag = endTagXml;
              } else if (accumulatedRawContent.includes(startTagGemma)) {
                currentStartTag = startTagGemma;
                currentEndTag = endTagGemma;
              }
              
              if (currentStartTag) {
                const startIdx = accumulatedRawContent.indexOf(currentStartTag);
                const endIdx = accumulatedRawContent.indexOf(currentEndTag);
                
                if (endIdx !== -1) {
                  const extractedThoughts = accumulatedRawContent.substring(startIdx + currentStartTag.length, endIdx);
                  const mainContent = accumulatedRawContent.substring(endIdx + currentEndTag.length);
                  
                  setStreamThoughts(coordinatorThoughts + '\n' + extractedThoughts);
                  setStreamContent(mainContent);
                } else {
                  const extractedThoughts = accumulatedRawContent.substring(startIdx + currentStartTag.length);
                  setStreamThoughts(coordinatorThoughts + '\n' + extractedThoughts);
                  setStreamContent('');
                }
              } else {
                setStreamContent(accumulatedRawContent);
              }
            } else if (eventType === 'tool') {
              setToolLogs(prev => [...prev, dataValue]);
            } else if (eventType === 'error') {
              console.error(dataValue);
              alert(`Error: ${dataValue.message}`);
            }
          }
        }
      }

      // Finish streaming, sync messages list
      fetchMessages(activeChatId);
      // Sync calendar events in case the AI modified schedule
      fetchCalendarEvents();
    } catch (err) {
      console.error(err);
      alert('Communication failed. Is LM Studio or backend active?');
    } finally {
      setIsStreaming(false);
    }
  };

  // Expandable thoughts wrapper component
  const ExpandableThoughts = ({ thoughts, defaultExpanded = false }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    useEffect(() => {
      setExpanded(defaultExpanded);
    }, [defaultExpanded]);

    if (!thoughts) return null;

    // Clean up reasoning tokens from output text
    const cleanedThoughts = thoughts
      .replace(/<\|channel>thought/g, '')
      .replace(/<channel\|>/g, '')
      .replace(/<think>/g, '')
      .replace(/<\/think>/g, '')
      .replace(/Thinking Process:/gi, '')
      .trim();

    if (!cleanedThoughts) return null;

    return (
      <div className="thoughts-container">
        <div className="thoughts-header" onClick={() => setExpanded(!expanded)}>
          <span>🧠 Agent Plan & Internal Thoughts</span>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
        {expanded && (
          <div className="thoughts-content">
            {cleanedThoughts}
          </div>
        )}
      </div>
    );
  };

  // Auth Screen Render
  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="logo-container">
            <img src="/logo.png" alt="Logo" className="app-logo" onError={(e) => e.target.src = 'https://placehold.co/100x100?text=AG'} />
            <h1 className="app-title">Private AI</h1>
          </div>
          <h2>{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
          
          {authError && <div className="error-banner">{authError}</div>}
          
          <form onSubmit={handleAuthSubmit}>
            <div className="form-group">
              <label>Username</label>
              <input 
                type="text" 
                className="form-control" 
                value={authForm.username}
                onChange={e => setAuthForm(prev => ({ ...prev, username: e.target.value }))}
                required
              />
            </div>
             <div className="form-group">
               <label>Password</label>
               <div style={{ position: 'relative' }}>
                 <input 
                   type={showAuthPassword ? 'text' : 'password'} 
                   className="form-control" 
                   style={{ paddingRight: '40px' }}
                   value={authForm.password}
                   onChange={e => setAuthForm(prev => ({ ...prev, password: e.target.value }))}
                   required
                 />
                 <button
                   type="button"
                   onClick={() => setShowAuthPassword(!showAuthPassword)}
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
                   {showAuthPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                 </button>
               </div>
             </div>
            <button type="submit" className="btn-primary">
              {isLogin ? 'Login' : 'Register'}
            </button>
          </form>

          <p className="auth-switch">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <span onClick={() => { setIsLogin(!isLogin); setAuthError(''); }}>
              {isLogin ? 'Register' : 'Login'}
            </span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <aside className={`sidebar ${isMobileSidebarOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src="/logo.png" alt="Logo" className="sidebar-logo" onError={(e) => e.target.src = 'https://placehold.co/100x100?text=AG'} />
            <h1>Private AI</h1>
          </div>
          <button className="btn-icon" onClick={() => setIsMobileSidebarOpen(false)} style={{ display: isMobileSidebarOpen ? 'block' : 'none' }}>
            <X size={20} />
          </button>
        </div>

        <button className="btn-new-chat" onClick={createChat}>
          <Plus size={18} />
          <span>New Chat</span>
        </button>

        <nav className="chat-list">
          {chats.map(chat => (
            <div 
              key={chat.id} 
              className={`chat-item ${activeChatId === chat.id ? 'active' : ''}`}
              onClick={() => {
                if (editingChatId !== chat.id) {
                  setActiveChatId(chat.id);
                  setActiveTab('chat');
                  setIsMobileSidebarOpen(false);
                }
              }}
            >
              <MessageSquare size={16} style={{ flexShrink: 0 }} />
              {editingChatId === chat.id ? (
                <input
                  type="text"
                  className="form-control"
                  style={{
                    padding: '2px 8px',
                    fontSize: '0.9rem',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: '6px',
                    color: '#fff',
                    margin: '0 4px',
                    width: '100%'
                  }}
                  value={editingTitle}
                  onChange={e => setEditingTitle(e.target.value)}
                  onBlur={() => handleRenameChat(chat.id, editingTitle)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenameChat(chat.id, editingTitle);
                    if (e.key === 'Escape') setEditingChatId(null);
                  }}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: '6px' }}>
                    {chat.title}
                  </span>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingChatId(chat.id);
                        setEditingTitle(chat.title);
                      }}
                      style={{ padding: '2px' }}
                    >
                      <Edit2 size={12} />
                    </button>
                    <button 
                      onClick={(e) => deleteChat(chat.id, e)}
                      style={{ padding: '2px' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className={`btn-new-chat ${activeTab === 'calendar' ? 'active' : ''}`} onClick={() => { setActiveTab('calendar'); setIsMobileSidebarOpen(false); }} style={{ margin: 0 }}>
            <Calendar size={18} />
            <span>My Calendar</span>
          </button>
          
          <div className="user-profile">
            <span>👤 {user?.username}</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button className="btn-icon" onClick={() => setIsSettingsOpen(true)}>
                <Settings size={18} />
              </button>
              <button className="btn-icon" onClick={handleLogout}>
                <LogOut size={18} />
              </button>
            </div>
          </div>
          <div style={{
            fontSize: '0.75rem',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            marginTop: '8px',
            opacity: 0.5
          }}>
            v{appVersion}
          </div>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="main-panel">
        <header className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn-icon" onClick={() => setIsMobileSidebarOpen(true)} style={{ display: 'block', transform: 'scale(1.2)' }}>
              <Menu size={22} className="md:hidden" />
            </button>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>
              {activeTab === 'chat' ? 'Private AI Assistant' : 'Schedule Manager'}
            </h2>
          </div>

          <div className="model-config-badge">
            <span className={`connection-dot ${settings.provider === 'gemini' ? 'online' : 'local'}`}></span>
            <span style={{ fontSize: '0.85rem', fontWeight: 550 }}>
              {settings.provider === 'gemini' ? 'Online: Gemini' : 'Local AI'} ({settings.model_name.split('/').pop()})
            </span>
          </div>
        </header>

        {activeTab === 'chat' ? (
          /* Chat pane */
          <div className="chat-pane">
            <div className="messages-scroller">
              {messages.length === 0 && !isStreaming && (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '20vh' }}>
                  <img src="/logo.png" alt="Logo" style={{ width: 80, height: 80, opacity: 0.5, marginBottom: 16 }} onError={(e) => e.target.src = 'https://placehold.co/100x100?text=AG'} />
                  <h3>Welcome to Private AI</h3>
                  <p style={{ fontSize: '0.9rem', marginTop: 8 }}>Ask me anything. I can browse the web, check GitHub, and manage your calendar.</p>
                </div>
              )}
              
              {messages.map(msg => (
                <div key={msg.id} className={`message-bubble-wrapper ${msg.role}`}>
                  {msg.thoughts && <ExpandableThoughts thoughts={msg.thoughts} />}
                  <div 
                    className="message-bubble"
                    dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) }}
                  />
                </div>
              ))}

              {/* Streaming Content indicators */}
              {isStreaming && (
                <div className="message-bubble-wrapper assistant">
                  {streamThoughts && <ExpandableThoughts thoughts={streamThoughts} defaultExpanded={true} />}
                  {toolLogs.map((log, idx) => (
                    <div key={idx} className="tool-call-log">
                      {log.tool === 'calendar' ? <Calendar size={14} /> : log.tool === 'github' ? <Github size={14} /> : <Search size={14} />}
                      <span>Running tool action: {log.action} ({JSON.stringify(log.params)})</span>
                    </div>
                  ))}
                  {(streamContent || isStreaming) && (
                    <div 
                      className={`message-bubble ${!streamContent ? 'typing-cursor' : ''}`}
                      dangerouslySetInnerHTML={{ __html: marked.parse(streamContent || 'Thinking...') }}
                    />
                  )}
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="input-pane">
              <div className="input-box">
                <input 
                  type="text" 
                  placeholder={activeChatId ? "Send a message..." : "Select or create a chat to begin"}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  disabled={!activeChatId || isStreaming}
                />
              </div>
              <button type="submit" className="btn-send" disabled={!activeChatId || isStreaming}>
                <Send size={18} />
              </button>
            </form>
          </div>
        ) : (
          /* Calendar view pane */
          <div className="chat-pane" style={{ overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', height: '100%' }}>
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
                      <div key={event.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', padding: 16, borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h4 style={{ fontWeight: 650 }}>{event.title}</h4>
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>🕒 {event.start_time} - {event.end_time}</p>
                          {event.description && <p style={{ fontSize: '0.9rem', marginTop: 8 }}>{event.description}</p>}
                        </div>
                        <button className="btn-icon" onClick={() => handleDeleteCalendarEvent(event.id)} style={{ color: '#ef4444' }}>
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
                  <button type="submit" className="btn-primary">Add Event</button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Assistant Settings</h3>
              <button className="btn-icon" onClick={() => setIsSettingsOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: 20, borderBottom: '1px solid var(--border-glass)' }}>
              <button 
                className={`settings-tab-btn ${settings.provider === 'local' ? 'active' : ''}`}
                onClick={() => setSettings(prev => ({ ...prev, provider: 'local' }))}
              >
                Local LLM
              </button>
              <button 
                className={`settings-tab-btn ${settings.provider === 'gemini' ? 'active' : ''}`}
                onClick={() => setSettings(prev => ({ ...prev, provider: 'gemini' }))}
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
                    <label>Local Model Name</label>
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
                      onChange={e => setSettings(prev => ({ ...prev, online_provider: e.target.value }))}
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
                    {settings.online_provider === 'gemini' ? (
                      <select 
                        className="form-control"
                        value={settings.model_name}
                        onChange={e => setSettings(prev => ({ ...prev, model_name: e.target.value }))}
                      >
                        <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                        <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                        <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                      </select>
                    ) : settings.online_provider === 'openai' ? (
                      <select 
                        className="form-control"
                        value={settings.model_name}
                        onChange={e => setSettings(prev => ({ ...prev, model_name: e.target.value }))}
                      >
                        <option value="gpt-4o">gpt-4o</option>
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                        <option value="o1-mini">o1-mini</option>
                      </select>
                    ) : settings.online_provider === 'anthropic' ? (
                      <select 
                        className="form-control"
                        value={settings.model_name}
                        onChange={e => setSettings(prev => ({ ...prev, model_name: e.target.value }))}
                      >
                        <option value="claude-3-5-sonnet-latest">claude-3-5-sonnet-latest</option>
                        <option value="claude-3-5-haiku-latest">claude-3-5-haiku-latest</option>
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
      )}
    </div>
  );
}

export default App;
