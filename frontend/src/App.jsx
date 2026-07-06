import React, { useState, useEffect, useRef } from 'react';
import { Menu, ExternalLink } from 'lucide-react';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import ChatPane from './components/ChatPane';
import CalendarPane from './components/CalendarPane';
import MemoryPane from './components/MemoryPane';
import SettingsModal from './components/SettingsModal';
import ProfileModal from './components/ProfileModal';
import AgentDashboard from './components/AgentDashboard';
import Toast from './components/Toast';
import SetupWizard from './components/SetupWizard';
import SudoModal from './components/SudoModal';
import PopoutWindow from './components/PopoutWindow';

function App() {
  // Auth state
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [isLogin, setIsLogin] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [toast, setToast] = useState({ message: '', type: 'info' });

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  // Navigation and panels
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'calendar'
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');

  const hasInitializedRef = useRef(false);
  const abortControllerRef = useRef(null);

  // Settings
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSetupComplete, setIsSetupComplete] = useState(true);
  const [sudoPrompt, setSudoPrompt] = useState(null); // { commandId, approved, editedCmd, commandText }
  const [settings, setSettings] = useState({
    provider: 'local',
    model_name: 'google/gemma-4-e4b',
    github_token: '',
    local_key: '',
    local_url: 'http://192.168.1.42:1234/v1',
    local_api_style: 'openai',
    online_url: '',
    online_key: '',
    online_provider: 'gemini',
    is_main_host: false
  });
  const [localModels, setLocalModels] = useState([]);
  const [onlineModels, setOnlineModels] = useState([]);
  const [appVersion, setAppVersion] = useState('4.3.0');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showLocalKey, setShowLocalKey] = useState(false);
  const [showOnlineKey, setShowOnlineKey] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profile, setProfile] = useState({ name: '', zipcode: '', country: 'US', temp_unit: 'imperial', weather_api_key: '', dob: '', gender: '', political_leaning: 'Undecided', interests: [] });

  // Calendar
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarForm, setCalendarForm] = useState({ title: '', start_time: '', end_time: '', description: '' });
  const [calendarDate, setCalendarDate] = useState(new Date().toISOString().split('T')[0]);

  // Input & Streaming state
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isChatPoppedOut, setIsChatPoppedOut] = useState(false);
  const [activeAgent, setActiveAgent] = useState(null);
  const [streamThoughts, setStreamThoughts] = useState('');
  const [streamContent, setStreamContent] = useState('');
  const [toolLogs, setToolLogs] = useState([]); // array of active/past tool calls
  const [streamStatus, setStreamStatus] = useState('');

  const messagesEndRef = useRef(null);

  // Load user data & chats if token is present
  useEffect(() => {
    if (token) {
      hasInitializedRef.current = false;
      localStorage.setItem('token', token);
      fetchUserProfile();
      fetchChats();
      fetchSettings();
      fetchCalendarEvents();
      fetchProfile();
      fetchMemories();
    } else {
      localStorage.removeItem('token');
      setUser(null);
    }
  }, [token]);

  useEffect(() => {
    if (isSettingsOpen && token) {
      fetchLocalModels(settings);
      fetchOnlineModels();
    }
  }, [isSettingsOpen]);

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
    setIsChatPoppedOut(false);
  };

  // Chats operations
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

  const fetchChats = async () => {
    try {
      const res = await fetch('/api/chats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChats(data);
        
        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;
        
        if (data.length > 0) {
          // Load the last active chat
          setActiveChatId(data[0].id);
          setActiveTab('chat');
        }
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
  const fetchLocalModels = async (tempSettings) => {
    try {
      const targetSettings = tempSettings || settings;
      let url = '/api/settings/local-models';
      if (targetSettings && targetSettings.local_url) {
        url += `?localUrl=${encodeURIComponent(targetSettings.local_url)}&localApiKey=${encodeURIComponent(targetSettings.local_key || '')}&localApiStyle=${encodeURIComponent(targetSettings.local_api_style || '')}`;
      }
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLocalModels(data);
        if (data.length === 0) {
          showToast('No models are currently loaded in LM Studio/Ollama.', 'warning');
        } else {
          showToast('Local models scanned successfully.', 'success');
        }
      } else {
        const errData = await res.json();
        showToast(`Failed to scan local models: ${errData.error || 'Connection failed'}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to scan local models: Connection failed', 'error');
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
          online_provider: data.online_provider || 'gemini',
          preferred_local_model: data.preferred_local_model || '',
          preferred_online_model: data.preferred_online_model || '',
          is_main_host: data.is_main_host === 1 || data.is_main_host === true || false
        });
        setIsSetupComplete(data.is_setup_complete !== false);
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

  const [memories, setMemories] = useState([]);

  const fetchMemories = async () => {
    try {
      const res = await fetch('/api/memories', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMemories(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddMemory = async ({ content, level }) => {
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content, level })
      });
      if (res.ok) {
        fetchMemories();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteMemory = async (id) => {
    try {
      const res = await fetch(`/api/memories/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchMemories();
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

  const handleResolveCommand = async (commandId, approved, editedCmd, password) => {
    const finalCmd = editedCmd !== undefined ? editedCmd : (document.getElementById(`cmd-input-${commandId}`)?.value || '');
    
    // Check if we need to show the sudo prompt first
    if (approved && finalCmd.includes('sudo') && !password) {
      setSudoPrompt({ commandId, approved, editedCmd: finalCmd, commandText: finalCmd });
      return;
    }

    setSudoPrompt(null);
    
    // Update local state to reflect approved or rejected status
    setToolLogs(prev => prev.map(log => 
      log.commandId === commandId 
        ? { ...log, status: approved ? 'approved' : 'rejected', command: approved ? finalCmd : log.command } 
        : log
    ));

    try {
      await fetch('/api/chat/approve-command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ commandId, approved, command: finalCmd, password })
      });
    } catch (err) {
      console.error('Failed to resolve command:', err);
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
    setActiveAgent('supervisor');
    setStreamThoughts('');
    setStreamContent('');
    setStreamStatus('');
    setToolLogs([]);

    let accumulatedRawContent = '';
    let coordinatorThoughts = '';

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        signal: controller.signal,
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

            if (eventType === 'status') {
              setStreamStatus(dataValue);
            } else if (eventType === 'agent_status') {
              if (dataValue && dataValue.agent !== undefined) {
                setActiveAgent(dataValue.agent);
              }
            } else if (eventType === 'thought') {
              coordinatorThoughts += dataValue;
              setStreamThoughts(coordinatorThoughts);
            } else if (eventType === 'content') {
              setStreamStatus(''); // Wipe stream status once real content rendering starts
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
              if (dataValue.agent) {
                setActiveAgent(dataValue.agent);
              } else if (dataValue.tool && dataValue.tool.startsWith('delegate_to_')) {
                setActiveAgent(dataValue.tool.replace('delegate_to_', ''));
              }
            } else if (eventType === 'command_approval_required') {
              setToolLogs(prev => [...prev, {
                type: 'command_approval',
                commandId: dataValue.commandId,
                command: dataValue.command,
                safety_analysis: dataValue.safety_analysis,
                status: 'pending'
              }]);
            } else if (eventType === 'error') {
              console.error(dataValue);
              showToast(`Error: ${dataValue.message}`, 'error');
            }
          }
        }
      }

      // Finish streaming, sync messages list
      fetchMessages(activeChatId);
      // Sync calendar events in case the AI modified schedule
      fetchCalendarEvents();
      // Sync memories in case the AI learned something new
      fetchMemories();
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Stream aborted by user.');
      } else {
        console.error(err);
        showToast('Communication failed. Is LM Studio or backend active?', 'error');
      }
    } finally {
      setIsStreaming(false);
      setActiveAgent(null);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
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

  if (!isSetupComplete) {
    return (
      <SetupWizard
        token={token}
        onComplete={() => {
          fetchSettings();
          fetchProfile();
        }}
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
              className="btn-icon mobile-menu-toggle" 
              onClick={() => setIsMobileSidebarOpen(true)} 
              style={{ transform: 'scale(1.2)' }}
            >
              <Menu size={22} />
            </button>
            <h2 
              style={{ fontSize: '1.2rem', fontWeight: 600, cursor: activeTab !== 'chat' ? 'pointer' : 'default' }}
              onClick={() => {
                if (activeTab !== 'chat') {
                  if (!activeChatId && chats.length > 0) setActiveChatId(chats[0].id);
                  setActiveTab('chat');
                }
              }}
              title={activeTab !== 'chat' ? "Return to Chat" : ""}
            >
              {activeTab === 'chat' ? 'Private AI Assistant' : (activeTab === 'calendar' ? 'Schedule Manager' : (activeTab === 'memory' ? 'AI Memory Vault' : 'Agent Dashboard'))}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>


            <div className="model-config-badge">
              <span className={`connection-dot ${settings.provider === 'gemini' ? 'online' : 'local'}`}></span>
              <span style={{ fontSize: '0.85rem', fontWeight: 550 }}>
                {settings.provider === 'gemini' ? 'Online: Gemini' : 'Local AI'} ({settings.model_name.split('/').pop()})
              </span>
            </div>
          </div>
        </header>

        {activeTab === 'chat' && !isChatPoppedOut && (
          <ChatPane
            settings={settings}
            messages={messages}
            activeChatId={activeChatId}
            isStreaming={isStreaming}
            streamThoughts={streamThoughts}
            streamContent={streamContent}
            toolLogs={toolLogs}
            inputText={inputText}
            setInputText={setInputText}
            handleSendMessage={handleSendMessage}
            handleStop={handleStop}
            messagesEndRef={messagesEndRef}
            handleResolveCommand={handleResolveCommand}
            streamStatus={streamStatus}
          />
        )}
        {activeTab === 'chat' && isChatPoppedOut && (
          <div className="chat-pane" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', color: 'var(--text-secondary)' }}>
            <ExternalLink size={48} className="text-accent-primary" style={{ opacity: 0.6, animation: 'pulse 2s infinite alternate' }} />
            <h3>Chat is Popped Out</h3>
            <p style={{ fontSize: '0.9rem', maxWidth: '350px', textAlign: 'center', lineHeight: '1.5' }}>
              The chat has been opened in a separate window. You can browse the dashboard, calendar, or memories here while keeping the chat active.
            </p>
            <button 
              className="btn btn-primary" 
              onClick={() => setIsChatPoppedOut(false)}
              style={{ padding: '8px 18px', fontSize: '0.9rem' }}
            >
              Merge Chat Back
            </button>
          </div>
        )}
        {activeTab === 'calendar' && (
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
        {activeTab === 'memory' && (
          <MemoryPane
            memories={memories}
            onAddMemory={handleAddMemory}
            onDeleteMemory={handleDeleteMemory}
          />
        )}
        {activeTab === 'dashboard' && (
          <AgentDashboard
            token={token}
            toolLogs={toolLogs}
            activeAgent={activeAgent}
            isStreaming={isStreaming}
            settings={settings}
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
        onFetchLocalModels={fetchLocalModels}
      />

      {/* Profile Modal */}
      <ProfileModal
        isProfileOpen={isProfileOpen}
        setIsProfileOpen={setIsProfileOpen}
        profile={profile}
        saveProfile={saveProfile}
        settings={settings}
        saveSettings={saveSettings}
        localModels={localModels}
        onlineModels={onlineModels}
      />

      {/* Sudo Modal */}
      <SudoModal
        isOpen={!!sudoPrompt}
        onClose={() => setSudoPrompt(null)}
        onSubmit={(password) => handleResolveCommand(sudoPrompt.commandId, sudoPrompt.approved, sudoPrompt.editedCmd, password)}
        command={sudoPrompt?.commandText || ''}
      />

      {/* Toast Notifications */}
      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast({ message: '', type: 'info' })}
      />

      {isChatPoppedOut && (
        <PopoutWindow onClose={() => setIsChatPoppedOut(false)}>
          <ChatPane
            settings={settings}
            messages={messages}
            activeChatId={activeChatId}
            isStreaming={isStreaming}
            streamThoughts={streamThoughts}
            streamContent={streamContent}
            toolLogs={toolLogs}
            inputText={inputText}
            setInputText={setInputText}
            handleSendMessage={handleSendMessage}
            handleStop={handleStop}
            messagesEndRef={messagesEndRef}
            handleResolveCommand={handleResolveCommand}
            streamStatus={streamStatus}
          />
        </PopoutWindow>
      )}
    </div>
  );
}

export default App;
