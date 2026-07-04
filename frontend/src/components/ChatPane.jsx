import React, { useState } from 'react';
import { Calendar, Github, Search, Send, Square, Cpu, CloudSun, Newspaper, FileText } from 'lucide-react';
import { marked } from 'marked';
import ExpandableThoughts from './ExpandableThoughts';

export default function ChatPane({
  messages,
  activeChatId,
  isStreaming,
  streamThoughts,
  streamContent,
  toolLogs,
  inputText,
  setInputText,
  handleSendMessage,
  handleStop,
  messagesEndRef,
  handleResolveCommand
}) {
  const [editedCommands, setEditedCommands] = useState({});

  const starterPrompts = [
    { icon: <Cpu size={16} color="#a78bfa" />, text: "Check host CPU temperature & RAM specs", query: "Can you inspect my computer specifications, thermal temperature, and battery telemetry?" },
    { icon: <CloudSun size={16} color="#38bdf8" />, text: "Check local weather forecast", query: "What is the weather forecast for my location?" },
    { icon: <Newspaper size={16} color="#34d399" />, text: "Summarize recent AI technology news", query: "Search for the latest artificial intelligence news articles and summarize them." },
    { icon: <FileText size={16} color="#f472b6" />, text: "Search Document Vault notes", query: "Query my document vault for relevant notes and information." }
  ];

  const handleCommandChange = (commandId, value) => {
    setEditedCommands(prev => ({ ...prev, [commandId]: value }));
  };

  return (
    <div className="chat-pane">
      <div className="messages-scroller">
        {!activeChatId ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '20vh' }}>
            <img 
              src="/logo.png" 
              alt="Logo" 
              style={{ width: 80, height: 80, opacity: 0.5, marginBottom: 16 }} 
              onError={(e) => e.target.src = 'https://placehold.co/100x100?text=AG'} 
            />
            <h3>No Active Chat</h3>
            <p style={{ fontSize: '0.9rem', marginTop: 8 }}>
              Please click <strong>New Chat</strong> in the sidebar to start a new chat.
            </p>
          </div>
        ) : (
          messages.length === 0 && !isStreaming && (
            <div className="starter-container">
              <img 
                src="/logo.png" 
                alt="Logo" 
                style={{ width: 72, height: 72, marginBottom: 16 }} 
                onError={(e) => e.target.src = 'https://placehold.co/100x100?text=AG'} 
              />
              <h3 className="starter-title">Welcome to Private AI</h3>
              <p className="starter-subtitle">
                Your private multi-agent assistant with web search, persistent memory storage, hardware sensors, and document vault.
              </p>
              <div className="starter-chips-grid">
                {starterPrompts.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="starter-chip"
                    onClick={() => setInputText(chip.query)}
                  >
                    {chip.icon}
                    <span>{chip.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )
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
            {toolLogs.map((log, idx) => {
              if (log.type === 'command_approval') {
                const currentCmd = editedCommands[log.commandId] !== undefined ? editedCommands[log.commandId] : log.command;
                return (
                  <div key={idx} className="memory-card" style={{ 
                    margin: '10px 0', 
                    padding: '16px', 
                    background: 'rgba(230, 80, 80, 0.1)', 
                    border: '1px solid rgba(230, 80, 80, 0.3)',
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: '#ff6b6b' }}>
                      🛡️ Host Script Execution Request
                    </div>
                    <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-secondary)' }}>
                      The AI wants to execute a terminal command. You can review, edit, or reject this request.
                    </p>
                    
                    {log.status === 'pending' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input 
                          type="text" 
                          className="form-control" 
                          value={currentCmd}
                          onChange={(e) => handleCommandChange(log.commandId, e.target.value)}
                          style={{ 
                            fontFamily: 'monospace', 
                            fontSize: '0.85rem', 
                            background: 'rgba(0,0,0,0.3)', 
                            border: '1px solid var(--accent-primary)',
                            color: '#fff',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            width: '100%'
                          }}
                        />
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button 
                            type="button"
                            className="btn btn-primary"
                            onClick={() => handleResolveCommand(log.commandId, true, currentCmd)}
                            style={{ padding: '6px 16px', fontSize: '0.85rem' }}
                          >
                            Approve
                          </button>
                          <button 
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleResolveCommand(log.commandId, false, currentCmd)}
                            style={{ padding: '6px 16px', fontSize: '0.85rem', border: '1px solid rgba(255,255,255,0.1)' }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.85rem', color: '#fff', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div>Command: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px' }}>{log.command}</code></div>
                        <div style={{ fontWeight: 600, color: log.status === 'approved' ? '#51cf66' : '#ff6b6b' }}>
                          Status: {log.status.toUpperCase()}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div key={idx} className="tool-call-log">
                  {log.tool === 'calendar' ? (
                    <Calendar size={14} />
                  ) : log.tool === 'github' ? (
                    <Github size={14} />
                  ) : (
                    <Search size={14} />
                  )}
                  <span>Running tool action: {log.action} ({JSON.stringify(log.params)})</span>
                </div>
              );
            })}
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
            placeholder={activeChatId ? (isStreaming ? "AI is thinking..." : "Send a message...") : "Select or create a chat to begin"}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            disabled={!activeChatId || isStreaming}
          />
        </div>
        {isStreaming ? (
          <button type="button" className="btn-stop" onClick={handleStop} title="Stop generating">
            <Square size={18} fill="currentColor" />
          </button>
        ) : (
          <button type="submit" className="btn-send" disabled={!activeChatId || !inputText.trim()}>
            <Send size={18} />
          </button>
        )}
      </form>
    </div>
  );
}

