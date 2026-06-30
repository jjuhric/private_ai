import React from 'react';
import { Calendar, Github, Search, Send } from 'lucide-react';
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
  messagesEndRef
}) {
  return (
    <div className="chat-pane">
      <div className="messages-scroller">
        {messages.length === 0 && !isStreaming && (
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
                {log.tool === 'calendar' ? (
                  <Calendar size={14} />
                ) : log.tool === 'github' ? (
                  <Github size={14} />
                ) : (
                  <Search size={14} />
                )}
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
  );
}
