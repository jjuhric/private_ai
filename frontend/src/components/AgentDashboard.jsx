import React, { useState, useEffect } from 'react';
import { Network, FileText, Upload, Trash2, Cpu, Eye, CheckCircle, RefreshCw, Layers } from 'lucide-react';

export default function AgentDashboard({ token, toolLogs }) {
  const [activeSubTab, setActiveSubTab] = useState('network'); // 'network' or 'vault'
  const [documents, setDocuments] = useState([]);
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Specialized Agent List
  const agents = [
    { name: 'Supervisor Agent', desc: 'Orchestrates conversation flow, delegates subtasks, and generates final user reports.', status: 'Idle', type: 'supervisor' },
    { name: 'Memory Agent', desc: 'Manages user memories, recalls preferences, stores facts, and cleans up expired short-term logs.', status: 'Idle', type: 'memory' },
    { name: 'Web Searcher', desc: 'Crawls Google and DuckDuckGo search results, retrieves top articles, and decodes news feeds.', status: 'Idle', type: 'crawler' },
    { name: 'Document Vault Agent', desc: 'Queries the local Document Vault using semantic RAG vector similarity to fetch private context.', status: 'Idle', type: 'rag' },
    { name: 'Coding Agent', desc: 'Inspects and modifies workspace files, integrates with GitHub API, and executes approved terminal scripts.', status: 'Idle', type: 'dev' },
    { name: 'QA Engineer', desc: 'Reviews code syntax, checks files for security issues, and runs project build verification tests.', status: 'Idle', type: 'qa' },
    { name: 'Weather Expert', desc: 'Resolves zipcodes to coordinates and pulls current, hourly, and daily forecasts.', status: 'Idle', type: 'weather' },
    { name: 'Host Specialist', desc: 'Queries CPU telemetry, memory usage, disk allocation, and live battery power specs.', status: 'Idle', type: 'host' }
  ];

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/vault', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!fileName || !fileContent.trim()) {
      setUploadError('Please specify a filename and enter some content.');
      return;
    }
    setUploadError('');
    setIsUploading(true);

    try {
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ filename: fileName, content: fileContent })
      });
      
      const data = await res.json();
      if (res.ok) {
        setFileName('');
        setFileContent('');
        fetchDocuments();
      } else {
        setUploadError(data.error || 'Failed to upload document.');
      }
    } catch (err) {
      setUploadError('Connection error while uploading.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this document? This will remove all vector chunks from RAG memory.')) return;
    try {
      const res = await fetch(`/api/vault/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchDocuments();
      }
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      setFileContent(evt.target.result);
    };
    reader.readAsText(file);
  };

  const getAgentStatus = (agentType) => {
    if (toolLogs && toolLogs.length > 0) {
      const lastLog = toolLogs[toolLogs.length - 1];
      if (lastLog.agent) {
        if (agentType === 'supervisor' && lastLog.agent === 'supervisor') return 'Active';
        if (agentType === 'memory' && lastLog.agent === 'memory_agent') return 'Active';
        if (agentType === 'crawler' && lastLog.agent === 'web_searcher') return 'Active';
        if (agentType === 'rag' && lastLog.agent === 'document_vault') return 'Active';
        if (agentType === 'dev' && (lastLog.agent === 'coder' || lastLog.agent === 'qa_engineer')) return 'Active';
        if (agentType === 'weather' && lastLog.agent === 'weather_expert') return 'Active';
        if (agentType === 'host' && lastLog.agent === 'host_specialist') return 'Active';
      }
      // Map tool log to agent type (fallback)
      if (agentType === 'supervisor') return 'Active';
      if (agentType === 'memory' && lastLog.tool === 'memory') return 'Active';
      if (agentType === 'crawler' && (lastLog.tool === 'search_web' || lastLog.tool === 'google_news')) return 'Active';
      if (agentType === 'rag' && lastLog.tool === 'query_vault') return 'Active';
      if (agentType === 'dev' && (lastLog.tool === 'read_file' || lastLog.tool === 'write_file' || lastLog.tool === 'execute_command' || lastLog.tool === 'github')) return 'Active';
      if (agentType === 'weather' && lastLog.tool === 'weather') return 'Active';
      if (agentType === 'host' && lastLog.tool === 'host_machine') return 'Active';
    }
    return 'Idle';
  };

  return (
    <div className="memory-pane" style={{ padding: '24px', overflowY: 'auto', height: '100%' }}>
      <div className="section-header" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Network className="text-accent-primary" size={24} />
          <h2>Agent Network Dashboard</h2>
        </div>
        <div className="sub-tab-buttons" style={{ display: 'flex', gap: '8px' }}>
          <button 
            className={`btn btn-secondary ${activeSubTab === 'network' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('network')}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            <Layers size={14} style={{ marginRight: '6px' }} />
            Agent Network
          </button>
          <button 
            className={`btn btn-secondary ${activeSubTab === 'vault' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('vault')}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            <FileText size={14} style={{ marginRight: '6px' }} />
            Document Vault (RAG)
          </button>
        </div>
      </div>

      {activeSubTab === 'network' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Agent Status Grid */}
          <div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', color: 'var(--text-primary)' }}>Active Agent Registry</h3>
            <div className="memory-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {agents.map((agent, index) => {
                const status = getAgentStatus(agent.type);
                return (
                  <div key={index} className="memory-card" style={{ padding: '16px', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <h4 style={{ fontWeight: 600, fontSize: '0.95rem', color: '#fff' }}>{agent.name}</h4>
                      <span className={`badge ${status === 'Active' ? 'badge-short-term' : 'badge-long-term'}`} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                        {status}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{agent.desc}</p>
                    {status === 'Active' && (
                      <div className="pulsing-glow" style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        border: '1px solid var(--accent-primary)',
                        borderRadius: '12px',
                        pointerEvents: 'none',
                        animation: 'pulse 1.5s infinite alternate'
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Real-time Agent Execution logs */}
          <div className="memory-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={18} className="text-accent-primary" /> Live Agent Routing Sequence
            </h3>
            {toolLogs && toolLogs.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {toolLogs.map((log, idx) => (
                  <div key={idx} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '12px', 
                    padding: '8px 12px', 
                    background: 'rgba(255,255,255,0.05)', 
                    borderRadius: '8px', 
                    fontSize: '0.85rem'
                  }}>
                    <CheckCircle size={14} className="text-accent-primary" />
                    <div>
                      <strong style={{ color: '#fff' }}>[{log.tool.toUpperCase()}]</strong> action: <code>{log.action}</code>
                      {log.params && <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>({JSON.stringify(log.params)})</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                No active session logs. Interact with the chat supervisor to trigger agent routing.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'start' }}>
          {/* Document Upload panel */}
          <div className="memory-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: '#fff' }}>Add Document to RAG Vault</h3>
            <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Upload File (.txt, .md)</label>
                <input 
                  type="file" 
                  accept=".txt,.md" 
                  onChange={handleFileInputChange} 
                  className="form-control" 
                  style={{ padding: '8px', background: 'rgba(0,0,0,0.2)' }}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Document Name</label>
                <input 
                  type="text" 
                  placeholder="document_name.txt"
                  value={fileName}
                  onChange={e => setFileName(e.target.value)}
                  className="form-control"
                  required
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Document Raw Content</label>
                <textarea 
                  rows={8}
                  placeholder="Paste document text context here to parse and index..."
                  value={fileContent}
                  onChange={e => setFileContent(e.target.value)}
                  className="form-control"
                  style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
                  required
                />
              </div>

              {uploadError && <div style={{ color: '#ff6b6b', fontSize: '0.8rem' }}>{uploadError}</div>}

              <button type="submit" className="btn btn-primary" disabled={isUploading} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isUploading ? <RefreshCw size={14} className="spin" /> : <Upload size={14} />}
                {isUploading ? 'Chunking & Embedding...' : 'Index Document'}
              </button>
            </form>
          </div>

          {/* Indexed Documents list */}
          <div className="memory-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: '#fff' }}>Indexed Documents</h3>
            {documents.length > 0 ? (
              <div style={{ maxHeight: '450px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '8px' }}>Filename</th>
                      <th style={{ padding: '8px' }}>Size</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map(doc => (
                      <tr key={doc.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '10px 8px', color: '#fff', fontWeight: 500 }}>{doc.filename}</td>
                        <td style={{ padding: '10px 8px', color: 'var(--text-secondary)' }}>{(doc.file_size / 1024).toFixed(1)} KB</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                          <button 
                            className="btn btn-icon" 
                            onClick={() => handleDelete(doc.id)}
                            style={{ color: '#ff6b6b', padding: '4px' }}
                            title="Delete document and remove all vector indexes"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-secondary)' }}>
                No documents indexed in your Private RAG Vault. Write or upload files to start querying private files.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
