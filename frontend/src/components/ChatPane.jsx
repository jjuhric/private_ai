import React from 'react';
import { Calendar, Github, Search, Send, Square } from 'lucide-react';
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
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '20vh' }}>
              <img 
                src="/logo.png" 
                alt="Logo" 
                style={{ width: 80, height: 80, opacity: 0.5, marginBottom: 16 }} 
                onError={(e) => e.target.src = 'https://placehold.co/100x100?text=AG'} 
              />
              <h3>Welcome to Private AI</h3>
              <p style={{ fontSize: '0.9rem', marginTop: 8 }}>
                Ask me anything. I can browse the web, check GitHub, and manage your calendar.
              </p>
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
                          id={`cmd-input-${log.commandId}`}
                          defaultValue={log.command}
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
                            onClick={() => handleResolveCommand(log.commandId, true)}
                            style={{ padding: '6px 16px', fontSize: '0.85rem' }}
                          >
                            Approve
                          </button>
                          <button 
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleResolveCommand(log.commandId, false)}
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
