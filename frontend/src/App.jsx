import React, { useState, useEffect, useRef } from 'react';
import { Menu } from 'lucide-react';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import ChatPane from './components/ChatPane';
import CalendarPane from './components/CalendarPane';
import SettingsModal from './components/SettingsModal';
import ProfileModal from './components/ProfileModal';

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
  const [onlineModels, setOnlineModels] = useState([]);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showLocalKey, setShowLocalKey] = useState(false);
  const [showOnlineKey, setShowOnlineKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profile, setProfile] = useState({ name: '', zipcode: '', country: 'US', temp_unit: 'imperial', weather_api_key: '' });

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
      fetchProfile();
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

  const fetchOnlineModels = async () => {
    try {
      const res = await fetch('/api/settings/online-models', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setOnlineModels(data);
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
      fetchOnlineModels();
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
        fetchLocalModels();
        fetchOnlineModels();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveProfile = async (newProfile) => {
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newProfile)
      });
      if (res.ok) {
        setProfile(newProfile);
        setIsProfileOpen(false);
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

  // Auth Screen Render
  if (!token) {
    return (
      <Auth
        authForm={authForm}
        setAuthForm={setAuthForm}
        isLogin={isLogin}
        setIsLogin={setIsLogin}
        authError={authError}
        setAuthError={setAuthError}
        handleAuthSubmit={handleAuthSubmit}
        showAuthPassword={showAuthPassword}
        setShowAuthPassword={setShowAuthPassword}
      />
    );
  }

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <Sidebar
        user={user}
        chats={chats}
        activeChatId={activeChatId}
        setActiveChatId={setActiveChatId}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isMobileSidebarOpen={isMobileSidebarOpen}
        setIsMobileSidebarOpen={setIsMobileSidebarOpen}
        editingChatId={editingChatId}
        setEditingChatId={setEditingChatId}
        editingTitle={editingTitle}
        setEditingTitle={setEditingTitle}
        createChat={createChat}
        deleteChat={deleteChat}
        handleRenameChat={handleRenameChat}
        handleLogout={handleLogout}
        setIsSettingsOpen={setIsSettingsOpen}
        setIsProfileOpen={setIsProfileOpen}
        appVersion={appVersion}
      />

      {/* Main Panel */}
      <main className="main-panel">
        <header className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              className="btn-icon" 
              onClick={() => setIsMobileSidebarOpen(true)} 
              style={{ display: 'block', transform: 'scale(1.2)' }}
            >
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
          <ChatPane
            messages={messages}
            activeChatId={activeChatId}
            isStreaming={isStreaming}
            streamThoughts={streamThoughts}
            streamContent={streamContent}
            toolLogs={toolLogs}
            inputText={inputText}
            setInputText={setInputText}
            handleSendMessage={handleSendMessage}
            messagesEndRef={messagesEndRef}
          />
        ) : (
          <CalendarPane
            calendarEvents={calendarEvents}
            calendarForm={calendarForm}
            setCalendarForm={setCalendarForm}
            calendarDate={calendarDate}
            setCalendarDate={setCalendarDate}
            handleAddCalendarEvent={handleAddCalendarEvent}
            handleDeleteCalendarEvent={handleDeleteCalendarEvent}
          />
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isSettingsOpen={isSettingsOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        settings={settings}
        setSettings={setSettings}
        localModels={localModels}
        onlineModels={onlineModels}
        saveSettings={saveSettings}
        showLocalKey={showLocalKey}
        setShowLocalKey={setShowLocalKey}
        showOnlineKey={showOnlineKey}
        setShowOnlineKey={setShowOnlineKey}
        showGithubToken={showGithubToken}
        setShowGithubToken={setShowGithubToken}
      />

      {/* Profile Modal */}
      <ProfileModal
        isProfileOpen={isProfileOpen}
        setIsProfileOpen={setIsProfileOpen}
        profile={profile}
        saveProfile={saveProfile}
      />
    </div>
  );
}

export default App;
