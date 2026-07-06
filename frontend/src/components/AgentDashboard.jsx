import React, { useState, useEffect } from 'react';
import { Network, FileText, Upload, Trash2, Cpu, Eye, CheckCircle, RefreshCw, Layers, Plus, Server, Monitor, Search, BookOpen, X, BarChart2, Cloud, GitBranch, Code, Shield, Wrench, UserPlus, Calendar } from 'lucide-react';

function TokenChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ display: 'flex', height: '240px', alignItems: 'center', justifyContent: 'center', width: '100%', color: 'var(--text-secondary)' }}>
        No data to display in chart.
      </div>
    );
  }

  const padding = 45;
  const width = 600;
  const height = 260;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const maxValue = Math.max(...data.map(d => d.value), 100);

  // Generate coordinates for SVG path
  const points = data.map((d, index) => {
    const x = padding + (index / (data.length - 1 || 1)) * chartWidth;
    const y = padding + chartHeight - (d.value / maxValue) * chartHeight;
    return { x, y, label: d.label, value: d.value };
  });

  const pathD = points.reduce((acc, p, index) => {
    return index === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, '');

  const areaD = points.length > 0 
    ? `${pathD} L ${points[points.length - 1].x} ${padding + chartHeight} L ${points[0].x} ${padding + chartHeight} Z`
    : '';

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        
        {/* Y Axis Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
          const y = padding + chartHeight - ratio * chartHeight;
          const labelVal = Math.round(ratio * maxValue);
          return (
            <g key={idx}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
              <text x={padding - 10} y={y + 4} textAnchor="end" fill="var(--text-secondary)" style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                {labelVal >= 1000 ? `${(labelVal / 1000).toFixed(1)}k` : labelVal}
              </text>
            </g>
          );
        })}

        {/* X Axis Labels */}
        {points.map((p, idx) => (
          <text key={idx} x={p.x} y={height - padding + 22} textAnchor="middle" fill="var(--text-secondary)" style={{ fontSize: '10px' }}>
            {p.label}
          </text>
        ))}

        {/* Area Fill */}
        {areaD && <path d={areaD} fill="url(#chartGradient)" />}

        {/* Line Path */}
        {pathD && <path d={pathD} fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}

        {/* Dots and Tooltips */}
        {points.map((p, idx) => (
          <g key={idx} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r="4" fill="var(--accent-secondary)" stroke="#0b0f19" strokeWidth="2" />
            <circle cx={p.x} cy={p.y} r="12" fill="transparent" />
            <title>{`${p.value.toLocaleString()} tokens\n${p.label}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}

function LMStudioLogsView({ token }) {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [filter, setFilter] = useState('all'); // 'all', 'server', 'model'

  const handleClearLogs = async () => {
    if (!window.confirm('Are you sure you want to wipe the active LM Studio log file on disk?')) {
      return;
    }
    try {
      const res = await fetch('/api/lmstudio/clear-logs', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setLogs([]);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to clear logs.');
      }
    } catch (err) {
      alert(`Error clearing logs: ${err.message}`);
    }
  };

  useEffect(() => {
    let url = `/api/lmstudio/log-stream?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setStatus('connected');
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'system', text: 'Live log stream connection established.' }]);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        let logText = data.message;
        let logType = data.type; // 'log', 'stderr', 'error'
        let parsedMessage = null;

        try {
          parsedMessage = JSON.parse(logText);
        } catch (e) {
          // message is raw text
        }

        setLogs(prev => {
          const newLogs = [...prev, {
            time: new Date().toLocaleTimeString(),
            type: logType,
            rawText: logText,
            parsed: parsedMessage
          }];
          return newLogs.slice(-400); // cap at 400 lines
        });
      } catch (err) {
        console.error('Failed to parse SSE message:', err);
      }
    };

    eventSource.onerror = () => {
      setStatus('disconnected');
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type: 'error', text: 'Connection lost. Reconnecting...' }]);
    };

    return () => {
      eventSource.close();
    };
  }, [token]);

  // Filter logs
  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    if (log.parsed) {
      return log.parsed.source === filter;
    }
    return false;
  });

  // Automatically scroll to bottom of logs
  const terminalEndRef = React.useRef(null);
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredLogs]);

  return (
    <div className="card" style={{ background: 'rgba(10, 15, 30, 0.7)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', height: '600px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: status === 'connected' ? '#10b981' : '#f59e0b', display: 'inline-block' }}></span>
            LM Studio Log Stream
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Status: {status} (CLI output captures)
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {['all', 'server', 'model'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                border: 'none',
                color: '#fff',
                fontSize: '0.75rem',
                padding: '4px 10px',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              {f.toUpperCase()}
            </button>
          ))}
          <button
            onClick={handleClearLogs}
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#fca5a5',
              fontSize: '0.75rem',
              padding: '4px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              marginLeft: '8px'
            }}
          >
            Clear Logs
          </button>
        </div>
      </div>

      <div style={{
        flexGrow: 1,
        background: '#040711',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '8px',
        padding: '16px',
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        color: '#a7f3d0',
        overflowY: 'auto',
        whiteSpace: 'pre-wrap',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }}>
        {filteredLogs.map((log, idx) => {
          if (log.type === 'system') {
            return (
              <div key={idx} style={{ color: '#60a5fa' }}>
                [{log.time}] SYSTEM: {log.text}
              </div>
            );
          }
          if (log.type === 'error') {
            return (
              <div key={idx} style={{ color: '#f87171' }}>
                [{log.time}] ERROR: {log.text || log.rawText}
              </div>
            );
          }
          if (log.type === 'stderr') {
            return (
              <div key={idx} style={{ color: '#fb923c' }}>
                [{log.time}] STDERR: {log.rawText}
              </div>
            );
          }

          // Parse and render formatted json log from lms
          if (log.parsed) {
            const p = log.parsed;
            const levelColor = p.level === 'error' ? '#f87171' : p.level === 'warning' ? '#fb923c' : '#34d399';
            const sourceColor = p.source === 'model' ? '#a78bfa' : '#60a5fa';
            return (
              <div key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '2px' }}>
                <span style={{ color: '#6b7280' }}>[{log.time}]</span>{' '}
                <span style={{ color: sourceColor }}>[{p.source || 'server'}]</span>{' '}
                <span style={{ color: levelColor }}>{p.level?.toUpperCase() || 'INFO'}:</span>{' '}
                <span style={{ color: '#e2e8f0' }}>{p.message}</span>
                {p.stats && (
                  <span style={{ color: '#a7f3d0', marginLeft: '8px', fontSize: '0.75rem' }}>
                    ({JSON.stringify(p.stats)})
                  </span>
                )}
              </div>
            );
          }

          return (
            <div key={idx}>
              <span style={{ color: '#6b7280' }}>[{log.time}]</span> {log.rawText}
            </div>
          );
        })}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}

const agents = [
  {
    type: 'supervisor',
    name: 'Supervisor Agent',
    icon: Network,
    desc: 'Master orchestrator. Reads the full agent capability registry and routes every task to the best-suited specialist agent.'
  },
  {
    type: 'weather',
    name: 'Weather Expert',
    icon: Cloud,
    desc: 'Fetches current conditions, hourly forecasts, and daily weather data using your zipcode.'
  },
  {
    type: 'system',
    name: 'System Agent',
    icon: Cpu,
    desc: 'Queries local host: CPU, RAM, disk, temperature, processes, services, security scans, and scripting on the current machine only.'
  },
  {
    type: 'node',
    name: 'Node Agent',
    icon: Server,
    desc: 'Routes commands and queries to remote RPi or ESP32 field nodes. Cannot query Main Host from a remote context.'
  },
  {
    type: 'memory',
    name: 'Memory Agent',
    icon: BookOpen,
    desc: 'Stores, recalls, and forgets long-term and short-term memories about the user.'
  },
  {
    type: 'calendar',
    name: 'Calendar Agent',
    icon: Calendar,
    desc: 'Manages calendar events: listing, adding, or deleting scheduled events.'
  },
  {
    type: 'crawler',
    name: 'Web Searcher',
    icon: Search,
    desc: 'Performs live web searches and Google News lookups, aligning results with stored user interests.'
  },
  {
    type: 'rag',
    name: 'Document Vault Agent',
    icon: FileText,
    desc: 'Performs semantic vector search over uploaded private documents using cosine similarity.'
  },
  {
    type: 'github',
    name: 'GitHub Agent',
    icon: GitBranch,
    desc: 'Performs GitHub operations: branching, committing, PRs. Cannot push to main/master or create repos.'
  },
  {
    type: 'dev',
    name: 'Coding Agent',
    icon: Code,
    desc: 'Reads, writes, and manages source code files. Reports back to Supervisor before executing mutations.'
  },
  {
    type: 'qa',
    name: 'QA Engineer',
    icon: Shield,
    desc: 'Reviews code for bugs, vulnerabilities, and test coverage. Issues APPROVE or REJECT verdicts.'
  },
  {
    type: 'tool_creator',
    name: 'Tool Creation Agent',
    icon: Wrench,
    desc: 'Coordinates dynamic tool creation: designs plan, requests HITL approval, then implements and deploys.'
  },
  {
    type: 'agent_creator',
    name: 'Agent Creation Agent',
    icon: UserPlus,
    desc: 'Dynamically designs and integrates new specialist agents into the multi-agent loop.'
  },
  {
    type: 'developer',
    name: 'Developer Agent',
    icon: Layers,
    desc: 'Orchestrates software development pipelines: manifest, handler code, tests, and deployment via dev_pipeline tool.'
  }
];

export default function AgentDashboard({ token, toolLogs, activeAgent, isStreaming, settings }) {
  console.log('[AgentDashboard] settings:', settings, 'hostname:', window.location.hostname, 'port:', window.location.port);
  const [activeSubTab, setActiveSubTab] = useState('network'); // 'network', 'vault', 'host', 'nodes'
  const [documents, setDocuments] = useState([]);
  
  // Nodes State
  const [nodes, setNodes] = useState([]);
  const [showAddNode, setShowAddNode] = useState(false);
  const [newNode, setNewNode] = useState({ node_name: '', device_type: 'rpi-5-8gb', ip_address: '', port: 3000, bridge_secret: '' });
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Host telemetry and service control states
  const [hostStatus, setHostStatus] = useState(null);
  const [loadingHost, setLoadingHost] = useState(false);
  const [restartServiceName, setRestartServiceName] = useState('private-ai');
  const [restartingService, setRestartingService] = useState(false);

   // Scanner and Walkthrough State
  const [scanning, setScanning] = useState(false);
  const [discoveredNodes, setDiscoveredNodes] = useState([]);
  
  // Health Polling State & Logic (Rule 5)
  const [nodeHealthMap, setNodeHealthMap] = useState({});

  // Token usage states
  const [tokenData, setTokenData] = useState(null);
  const [tokenTimeframe, setTokenTimeframe] = useState('24h');
  const [loadingTokens, setLoadingTokens] = useState(false);

  const fetchTokenData = async (frame) => {
    setLoadingTokens(true);
    try {
      const res = await fetch(`/api/token-usage?timeframe=${frame}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTokenData(data);
      }
    } catch (err) {
      console.error('Failed to fetch token usage:', err);
    } finally {
      setLoadingTokens(false);
    }
  };

  const performNodeHealthPoll = async (configuredNodes) => {
    const results = await Promise.all(
      configuredNodes.map(async (node) => {
        try {
          const targetUrl = `http://${node.ip_address}:${node.port}/api/bridge/health`;
          const res = await fetch(targetUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            return { id: node.id, health: data };
          }
        } catch (err) {}
        return { id: node.id, health: { status: 'offline', dependencies: {} } };
      })
    );

    setNodeHealthMap(prev => {
      const nextHealth = { ...prev };
      for (const res of results) {
        nextHealth[res.id] = res.health;
      }
      return nextHealth;
    });
  };
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedGuideDevice, setSelectedGuideDevice] = useState('rpi-5-8gb');

  const handleScanNodes = async () => {
    setScanning(true);
    setDiscoveredNodes([]);
    try {
      const res = await fetch('/api/nodes/scan', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDiscoveredNodes(data.nodes || []);
      } else {
        alert('Failed to scan local network.');
      }
    } catch (err) {
      alert(`Error scanning network: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  const [registeringNode, setRegisteringNode] = useState(null);

  const handleConfirmRegisterNode = async (e) => {
    if (e) e.preventDefault();
    if (!registeringNode) return;
    try {
      const res = await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(registeringNode)
      });
      if (res.ok) {
        fetchNodes();
        setDiscoveredNodes(prev => prev.filter(n => n.ip_address !== registeringNode.ip_address));
        setRegisteringNode(null);
      } else {
        const data = await res.json();
        alert(`Failed to register discovered node: ${data.error}`);
      }
    } catch (err) {
      alert(`Error registering node: ${err.message}`);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'host') {
      fetchHostStatus();
      if (typeof window !== 'undefined' && !window.__vitest_worker__ && !process.env.VITEST) {
        const interval = setInterval(fetchHostStatus, 10000);
        return () => clearInterval(interval);
      }
    }
    if (activeSubTab === 'nodes') {
      fetchNodes();
    }
  }, [activeSubTab]);

  useEffect(() => {
    if (activeSubTab === 'nodes' && nodes.length > 0) {
      performNodeHealthPoll(nodes);
      const intervalId = setInterval(() => {
        performNodeHealthPoll(nodes);
      }, 60000);
      return () => clearInterval(intervalId);
    }
  }, [activeSubTab, nodes]);

  useEffect(() => {
    if (activeSubTab === 'tokens') {
      fetchTokenData(tokenTimeframe);
    }
  }, [activeSubTab, tokenTimeframe]);

  const fetchNodes = async () => {
    try {
      const res = await fetch('/api/nodes', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setNodes(await res.json());
    } catch (err) { console.error('Failed to fetch nodes:', err); }
  };

  const handleAddNode = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(newNode)
      });
      if (res.ok) {
        setNewNode({ node_name: '', device_type: 'rpi-5-8gb', ip_address: '', port: 3000, bridge_secret: '' });
        setShowAddNode(false);
        fetchNodes();
      } else {
        const data = await res.json();
        alert(`Failed to add node: ${data.error}`);
      }
    } catch (err) { alert(`Error adding node: ${err.message}`); }
  };

  const handleDeleteNode = async (id) => {
    if (!window.confirm('Remove this field node?')) return;
    try {
      const res = await fetch(`/api/nodes/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) fetchNodes();
    } catch (err) { alert(`Error deleting node: ${err.message}`); }
  };

  const fetchHostStatus = async () => {
    setLoadingHost(true);
    try {
      const res = await fetch('/api/host/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setHostStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch host status:', err);
    } finally {
      setLoadingHost(false);
    }
  };

  const handleRestartService = async () => {
    if (!restartServiceName.trim()) return;
    setRestartingService(true);
    try {
      const res = await fetch('/api/host/service/restart', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ service: restartServiceName })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Service restart initiated.');
      } else {
        alert(`Failed to restart service: ${data.error}`);
      }
    } catch (err) {
      alert(`Error restarting service: ${err.message}`);
    } finally {
      setRestartingService(false);
    }
  };



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
    // When streaming is explicitly finished (false), all agents return to Idle
    if (isStreaming === false) return 'Idle';

    let currentAgent = activeAgent || (toolLogs && toolLogs.length > 0 ? (toolLogs[toolLogs.length - 1].agent || toolLogs[toolLogs.length - 1].tool) : null) || (isStreaming ? 'supervisor' : null);
    if (!currentAgent) return 'Idle';

    currentAgent = currentAgent.toLowerCase().replace('delegate_to_', '');

    if (agentType === 'supervisor' && currentAgent === 'supervisor') return 'Active';
    if (agentType === 'memory' && (currentAgent === 'memory_agent' || currentAgent === 'memory')) return 'Active';
    if (agentType === 'calendar' && (currentAgent === 'calendar_handler' || currentAgent === 'calendar')) return 'Active';
    if (agentType === 'crawler' && (currentAgent === 'web_searcher' || currentAgent === 'search_web' || currentAgent === 'google_news')) return 'Active';
    if (agentType === 'rag' && (currentAgent === 'document_vault' || currentAgent === 'query_vault')) return 'Active';
    if (agentType === 'dev' && (currentAgent === 'coder' || currentAgent === 'read_file' || currentAgent === 'write_file' || currentAgent === 'execute_command')) return 'Active';
    if (agentType === 'github' && (currentAgent === 'github_agent' || currentAgent === 'github')) return 'Active';
    if (agentType === 'tool_creator' && (currentAgent === 'tool_creator_agent' || currentAgent === 'tool_creator' || currentAgent === 'dev_pipeline')) return 'Active';
    if (agentType === 'agent_creator' && (currentAgent === 'agent_creator_agent' || currentAgent === 'agent_creator')) return 'Active';
    if (agentType === 'qa' && currentAgent === 'qa_engineer') return 'Active';
    if (agentType === 'weather' && (currentAgent === 'weather_expert' || currentAgent === 'weather')) return 'Active';
    if (agentType === 'system' && (currentAgent === 'system_specialist' || currentAgent === 'system' || currentAgent === 'host_machine')) return 'Active';
    if (agentType === 'node' && (currentAgent === 'node_agent' || currentAgent === 'network_node' || currentAgent === 'list_network_nodes' || currentAgent === 'remote_node_bridge')) return 'Active';
    if (agentType === 'developer' && (currentAgent === 'developer_agent' || currentAgent === 'developer' || currentAgent === 'dev_pipeline')) return 'Active';

    return 'Idle';
  };

  const getBucketedGraphData = () => {
    if (!tokenData || !tokenData.graphData || tokenData.graphData.length === 0) return [];

    if (tokenTimeframe === 'last_request') {
      return tokenData.graphData.map(d => ({
        label: new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        value: d.token_count
      }));
    }

    const end = new Date().getTime();
    let start = end - 24 * 60 * 60 * 1000;
    let labelFormat = { hour: '2-digit', minute: '2-digit' };
    let useDate = false;

    if (tokenTimeframe === '1h') {
      start = end - 60 * 60 * 1000;
    } else if (tokenTimeframe === '12h') {
      start = end - 12 * 60 * 60 * 1000;
    } else if (tokenTimeframe === '24h') {
      start = end - 24 * 60 * 60 * 1000;
    } else if (tokenTimeframe === '7d') {
      start = end - 7 * 24 * 60 * 60 * 1000;
      labelFormat = { month: 'short', day: 'numeric' };
      useDate = true;
    } else if (tokenTimeframe === '30d') {
      start = end - 30 * 24 * 60 * 60 * 1000;
      labelFormat = { month: 'short', day: 'numeric' };
      useDate = true;
    } else if (tokenTimeframe === '365d') {
      start = end - 365 * 24 * 60 * 60 * 1000;
      labelFormat = { month: 'short' };
      useDate = true;
    }

    const range = end - start;
    const bucketCount = 8;
    const bucketSize = range / bucketCount;
    const buckets = Array.from({ length: bucketCount }, (_, i) => {
      const bucketStart = start + i * bucketSize;
      const bucketEnd = start + (i + 1) * bucketSize;
      const midTime = bucketStart + bucketSize / 2;
      const dateObj = new Date(midTime);
      const label = useDate 
        ? dateObj.toLocaleDateString([], labelFormat) 
        : dateObj.toLocaleTimeString([], labelFormat);
      return {
        startTime: bucketStart,
        endTime: bucketEnd,
        value: 0,
        label
      };
    });

    tokenData.graphData.forEach(d => {
      const time = new Date(d.created_at).getTime();
      const idx = Math.floor((time - start) / bucketSize);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].value += d.token_count;
      }
    });

    return buckets;
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
          <button 
            className={`btn btn-secondary ${activeSubTab === 'nodes' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('nodes')}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            <Server size={14} style={{ marginRight: '6px' }} />
            Field Nodes
          </button>
          <button 
            className={`btn btn-secondary ${activeSubTab === 'host' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('host')}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            <Cpu size={14} style={{ marginRight: '6px' }} />
            System Control
          </button>
          <button 
            className={`btn btn-secondary ${activeSubTab === 'tokens' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('tokens')}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            <BarChart2 size={14} style={{ marginRight: '6px' }} />
            Show Token Count
          </button>
          {settings?.is_main_host && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (window.location.port === '3000' || window.location.port === '5173') && (
            <button 
              className={`btn btn-secondary ${activeSubTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('logs')}
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            >
              <Monitor size={14} style={{ marginRight: '6px' }} />
              LM Studio Logs
            </button>
          )}
        </div>
      </div>

      {activeSubTab === 'network' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Agent Status Grid */}
          <div>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', color: 'var(--text-primary)' }}>Active Agent Registry</h3>
            <div className="memory-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {agents.map((agent, index) => {
                const status = getAgentStatus(agent.type);
                const IconComponent = agent.icon;
                return (
                  <div key={index} className="memory-card" style={{ padding: '16px', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {IconComponent && <IconComponent size={16} className={status === 'Active' ? 'text-accent-primary' : 'text-secondary'} />}
                        <h4 style={{ fontWeight: 600, fontSize: '0.95rem', color: '#fff', margin: 0 }}>{agent.name}</h4>
                      </div>
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
      )}

      {activeSubTab === 'vault' && (
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

      {activeSubTab === 'nodes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="memory-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <h3 style={{ fontSize: '1.1rem', color: '#fff', margin: 0 }}>Distributed Field Nodes</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={() => setShowInstallGuide(!showInstallGuide)} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '6px 12px' }}>
                  <BookOpen size={14} /> Install Guide
                </button>
                <button className="btn btn-secondary" onClick={handleScanNodes} disabled={scanning} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '6px 12px' }}>
                  <Search size={14} /> {scanning ? 'Scanning...' : 'Scan LAN'}
                </button>
                <button className="btn btn-primary" onClick={() => setShowAddNode(!showAddNode)} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '6px 12px' }}>
                  <Plus size={14} /> Add Node
                </button>
              </div>
            </div>

            {showInstallGuide && (
              <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ margin: 0, color: '#fff', fontSize: '0.95rem' }}>Device Setup Walkthrough Guide</h4>
                  <select 
                    className="form-control" 
                    value={selectedGuideDevice} 
                    onChange={e => setSelectedGuideDevice(e.target.value)}
                    style={{ width: 'auto', padding: '4px 8px', fontSize: '0.85rem' }}
                  >
                    <option value="rpi-5-8gb">Raspberry Pi 5 (8GB)</option>
                    <option value="rpi-5-16gb">Raspberry Pi 5 (16GB)</option>
                    <option value="esp32">ESP32 (MicroPython)</option>
                    <option value="windows">Windows / PC</option>
                  </select>
                </div>

                {selectedGuideDevice.startsWith('rpi') && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    <p><strong>To set up this Raspberry Pi as a Field Node:</strong></p>
                    <ol style={{ paddingLeft: '20px', margin: '0 0 10px 0' }}>
                      <li>Open a terminal on your Raspberry Pi.</li>
                      <li>Clone the project repository:<br />
                        <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px', display: 'block', margin: '4px 0', color: '#38bdf8' }}>
                          git clone https://github.com/jjuhric/private_ai.git
                        </code>
                      </li>
                      <li>Run the setup script:<br />
                        <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px', display: 'block', margin: '4px 0', color: '#38bdf8' }}>
                          cd private_ai && ./setup.sh
                        </code>
                      </li>
                      <li>Choose <strong>Field Node</strong> (Option 2) when prompted for role, and select your Raspberry Pi device type.</li>
                      <li>Enter your Main Host IP address when prompted:<br />
                        <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px', display: 'block', margin: '4px 0', color: '#34d399' }}>
                          {window.location.hostname || '192.168.1.42'}
                        </code>
                      </li>
                    </ol>
                    <p style={{ margin: 0 }}>💡 <em>Note: Leave the Bridge Secret blank here to automatically pair using the shared LLM API key.</em></p>
                  </div>
                )}

                {selectedGuideDevice === 'esp32' && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    <p><strong>To set up an ESP32 microcontroller as a Field Node:</strong></p>
                    <ol style={{ paddingLeft: '20px', margin: '0 0 10px 0' }}>
                      <li>Flash MicroPython onto your ESP32 board.</li>
                      <li>Upload the contents of the <code style={{ color: '#fff' }}>backend/nodes/esp32/</code> directory (containing <code style={{ color: '#fff' }}>boot.py</code> and <code style={{ color: '#fff' }}>main.py</code>) to your board.</li>
                      <li>Configure your local WiFi SSID and password in the configuration file on the board.</li>
                      <li>Set the matching authentication bridge secret.</li>
                    </ol>
                  </div>
                )}

                {selectedGuideDevice === 'windows' && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    <p><strong>To set up another Windows PC as a Field Node:</strong></p>
                    <ol style={{ paddingLeft: '20px', margin: '0 0 10px 0' }}>
                      <li>Clone the project repository in PowerShell:<br />
                        <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px', display: 'block', margin: '4px 0', color: '#38bdf8' }}>
                          git clone https://github.com/jjuhric/private_ai.git
                        </code>
                      </li>
                      <li>Navigate to the folder and execute setup:<br />
                        <code style={{ background: '#0f172a', padding: '2px 6px', borderRadius: '4px', display: 'block', margin: '4px 0', color: '#38bdf8' }}>
                          cd private_ai && .\setup.ps1
                        </code>
                      </li>
                      <li>Answer <strong>No (n)</strong> to the Main Host role prompt to install it as a Field Node.</li>
                    </ol>
                  </div>
                )}
              </div>
            )}

            {scanning && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '30px 10px', color: 'var(--text-secondary)' }}>
                <RefreshCw size={24} className="animate-spin text-accent-primary" />
                <span>Scanning local network subnet for active Private AI nodes...</span>
              </div>
            )}

            {!scanning && discoveredNodes.length > 0 && (
              <div style={{ padding: '16px', background: 'rgba(52,211,153,0.05)', borderRadius: '8px', marginBottom: '20px', border: '1px solid rgba(52,211,153,0.1)' }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#34d399', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle size={16} /> Discovered Nodes on LAN
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {discoveredNodes.map((n, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)', padding: '8px 12px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: 600, color: '#fff' }}>{n.ip_address}:{n.port}</span>
                        <span style={{ margin: '0 8px', color: 'var(--text-secondary)' }}>|</span>
                        <span style={{ color: 'var(--text-secondary)' }}>Type: {n.device_type}</span>
                        {n.is_main_host && <span style={{ marginLeft: '8px', background: 'var(--accent-primary)', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', color: '#fff' }}>Main Host</span>}
                      </div>
                      <button className="btn btn-primary" onClick={() => setRegisteringNode({ node_name: `${n.device_type.toUpperCase()} Node`, device_type: n.device_type, ip_address: n.ip_address, port: n.port, bridge_secret: '' })} style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                        Quick Register
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showAddNode && (
              <form onSubmit={handleAddNode} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px', padding: '16px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Node Name</label>
                    <input type="text" className="form-control" placeholder="e.g. Living Room Pi" required value={newNode.node_name} onChange={e => setNewNode({...newNode, node_name: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Device Type</label>
                    <select className="form-control" value={newNode.device_type} onChange={e => setNewNode({...newNode, device_type: e.target.value})}>
                      <option value="rpi-5-8gb">Raspberry Pi 5 (8GB)</option>
                      <option value="rpi-5-16gb">Raspberry Pi 5 (16GB)</option>
                      <option value="rpi-4-4gb">Raspberry Pi 4 (4GB+)</option>
                      <option value="rpi-zero-2w">Raspberry Pi Zero 2W</option>
                      <option value="esp32-wroom">ESP32 WROOM (WiFi)</option>
                      <option value="windows">Windows / PC</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>IP Address</label>
                    <input type="text" className="form-control" placeholder="192.168.1.50" required value={newNode.ip_address} onChange={e => setNewNode({...newNode, ip_address: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Bridge Secret (Optional)</label>
                    <input type="password" className="form-control" placeholder="Optional Auth Token" value={newNode.bridge_secret} onChange={e => setNewNode({...newNode, bridge_secret: e.target.value})} />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Save Node</button>
              </form>
            )}

            {nodes.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '8px' }}>Status</th>
                    <th style={{ padding: '8px' }}>Name</th>
                    <th style={{ padding: '8px' }}>Type</th>
                    <th style={{ padding: '8px' }}>IP:Port</th>
                    <th style={{ padding: '8px' }}>Subsystems Health</th>
                    <th style={{ padding: '8px' }}>Last Seen</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map(node => {
                    const health = nodeHealthMap[node.id];
                    const isOnline = health ? health.status === 'online' : node.is_online;
                    return (
                      <tr key={node.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ 
                            width: '10px', 
                            height: '10px', 
                            borderRadius: '50%', 
                            background: isOnline ? '#34d399' : '#ff6b6b',
                            boxShadow: isOnline ? '0 0 8px #34d399' : 'none'
                          }}></div>
                        </td>
                        <td style={{ padding: '10px 8px', color: '#fff', fontWeight: 500 }}>{node.node_name}</td>
                        <td style={{ padding: '10px 8px', color: 'var(--text-secondary)' }}>{node.device_type}</td>
                        <td style={{ padding: '10px 8px', color: 'var(--text-secondary)' }}>{node.ip_address}:{node.port}</td>
                        <td style={{ padding: '10px 8px' }}>
                          {health && health.dependencies ? (
                            <div style={{ display: 'flex', gap: '6px', fontSize: '0.75rem' }}>
                              <span className="badge" style={{ padding: '2px 6px', borderRadius: '4px', background: health.dependencies.llm_provider === 'stable' ? '#059669' : '#dc2626', color: '#fff' }}>
                                LLM: {health.dependencies.llm_provider === 'stable' ? 'OK' : 'ERR'}
                              </span>
                              <span className="badge" style={{ padding: '2px 6px', borderRadius: '4px', background: health.dependencies.database === 'stable' ? '#059669' : '#dc2626', color: '#fff' }}>
                                DB: {health.dependencies.database === 'stable' ? 'OK' : 'ERR'}
                              </span>
                              <span className="badge" style={{ padding: '2px 6px', borderRadius: '4px', background: health.dependencies.mqtt_broker === 'stable' ? '#059669' : '#dc2626', color: '#fff' }}>
                                MQTT: {health.dependencies.mqtt_broker === 'stable' ? 'OK' : 'ERR'}
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                              Awaiting telemetry sync...
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 8px', color: 'var(--text-secondary)' }}>{new Date(node.last_seen).toLocaleString()}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                          <button className="btn btn-icon" onClick={() => handleDeleteNode(node.id)} style={{ color: '#ff6b6b', padding: '4px' }}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-secondary)' }}>
                No remote nodes configured. Add an ESP32 or Raspberry Pi to distribute tasks.
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === 'host' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {hostStatus ? (
            <>
              {/* Telemetry Status Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <div className="memory-card" style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.7)', margin: '0 0 12px 0' }}>CPU Specifications</h3>
                  <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff', marginBottom: '8px' }}>
                    {hostStatus.cpu.cores} Cores
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Model: {hostStatus.cpu.model}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Load Avg: {hostStatus.cpu.loadAvg.map(l => l.toFixed(2)).join(', ')}
                  </div>
                </div>

                <div className="memory-card" style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.7)', margin: '0 0 12px 0' }}>Memory Utilization</h3>
                  <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff', marginBottom: '8px' }}>
                    {hostStatus.memory.percentage}% Used
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                    <div style={{ height: '100%', width: `${hostStatus.memory.percentage}%`, background: 'var(--accent-primary)' }}></div>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {(hostStatus.memory.used / 1024 / 1024 / 1024).toFixed(1)} GB / {(hostStatus.memory.total / 1024 / 1024 / 1024).toFixed(1)} GB
                  </div>
                </div>

                <div className="memory-card" style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.7)', margin: '0 0 12px 0' }}>Uptime</h3>
                  <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#fff', marginBottom: '8px' }}>
                    {Math.floor(hostStatus.uptime / 3600)}h {Math.floor((hostStatus.uptime % 3600) / 60)}m
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    System is running stable
                  </div>
                </div>
              </div>

              {/* Service Management Panel */}
              <div className="memory-card" style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: '#fff' }}>Service Management</h3>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                    <label>Systemd Service Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={restartServiceName}
                      onChange={e => setRestartServiceName(e.target.value)}
                      placeholder="e.g. private-ai"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleRestartService}
                    disabled={restartingService || !restartServiceName.trim()}
                    style={{ padding: '10px 24px' }}
                  >
                    {restartingService ? 'Restarting...' : '🔄 Restart Service'}
                  </button>
                </div>
              </div>

              {/* Live Reports & Telemetry Log views */}
              <div className="memory-card" style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', color: '#fff' }}>Detailed Hardware Telemetry</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {hostStatus.telemetry.temperature && (
                    <div>
                      <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '6px' }}>CPU Temperature Sensors</h4>
                      <pre style={{ margin: 0, padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.8rem', color: '#eee', whiteSpace: 'pre-wrap' }}>
                        {hostStatus.telemetry.temperature}
                      </pre>
                    </div>
                  )}

                  {hostStatus.telemetry.power && (
                    <div>
                      <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '6px' }}>Power Draw / Battery Diagnostics</h4>
                      <pre style={{ margin: 0, padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.8rem', color: '#eee', whiteSpace: 'pre-wrap' }}>
                        {hostStatus.telemetry.power}
                      </pre>
                    </div>
                  )}

                  {hostStatus.telemetry.network && (
                    <div>
                      <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '6px' }}>Network & WiFi Telemetry</h4>
                      <pre style={{ margin: 0, padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.8rem', color: '#eee', whiteSpace: 'pre-wrap' }}>
                        {hostStatus.telemetry.network}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-secondary)' }}>
              {loadingHost ? 'Loading system specs...' : 'Failed to retrieve system status.'}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'tokens' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Timeframe Selector and KPI Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div className="sub-tab-buttons" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { id: 'last_request', name: 'Last Request' },
                { id: '1h', name: 'Last Hour' },
                { id: '12h', name: 'Last 12 Hours' },
                { id: '24h', name: 'Last 24 Hours' },
                { id: '7d', name: 'Last Week' },
                { id: '30d', name: 'Last Month' },
                { id: '365d', name: 'Last Year' }
              ].map(t => (
                <button
                  key={t.id}
                  className={`btn btn-secondary ${tokenTimeframe === t.id ? 'active' : ''}`}
                  onClick={() => setTokenTimeframe(t.id)}
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                >
                  {t.name}
                </button>
              ))}
            </div>

            {/* Quick refresh button */}
            <button 
              className="btn btn-secondary" 
              onClick={() => fetchTokenData(tokenTimeframe)}
              disabled={loadingTokens}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', padding: '6px 12px' }}
            >
              <RefreshCw size={14} className={loadingTokens ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {/* Overall Token Count Card */}
          <div className="memory-card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '20px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', borderRadius: '16px', boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)' }}>
            <div style={{ background: 'var(--accent-glow)', padding: '12px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart2 size={32} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overall Token Count</div>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#fff', marginTop: '4px', textShadow: '0 0 10px var(--accent-glow)' }}>
                {tokenData && typeof tokenData.totalTokens === 'number' ? tokenData.totalTokens.toLocaleString() : 0}
              </div>
            </div>
          </div>

          {/* Grid containing Chart and Data Table */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
            {/* Chart Card */}
            <div className="memory-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '1.05rem', color: '#fff', fontWeight: 600 }}>Token Usage Timeline</h3>
              {loadingTokens ? (
                <div style={{ height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                  <RefreshCw size={24} className="animate-spin" />
                </div>
              ) : (
                <TokenChart data={getBucketedGraphData()} />
              )}
            </div>

            {/* Data Table Card */}
            <div className="memory-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '1.05rem', color: '#fff', fontWeight: 600 }}>Usage by Model</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '10px 8px', fontWeight: 600 }}>Model</th>
                      <th style={{ padding: '10px 8px', fontWeight: 600 }}>Local or Online</th>
                      <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Tokens</th>
                      <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokenData && tokenData.tableData && tokenData.tableData.length > 0 ? (
                      tokenData.tableData.map((item, idx) => {
                        const pct = tokenData.totalTokens > 0 
                          ? ((item.total_tokens / tokenData.totalTokens) * 100).toFixed(1) + '%'
                          : '0.0%';
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'var(--text-primary)' }}>
                            <td style={{ padding: '10px 8px', fontWeight: 500 }}>{item.model_name}</td>
                            <td style={{ padding: '10px 8px' }}>
                              <span className={`badge ${item.provider_type === 'online' ? 'badge-short-term' : 'badge-long-term'}`} style={{ fontSize: '0.7rem', padding: '2px 8px', textTransform: 'capitalize' }}>
                                {item.provider_type === 'online' ? 'Online' : 'Local'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{item.total_tokens ? item.total_tokens.toLocaleString() : 0}</td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--accent-secondary)' }}>{pct}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="4" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                          {loadingTokens ? 'Loading data...' : 'No token usage recorded for this timeframe.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'logs' && settings?.is_main_host && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (window.location.port === '3000' || window.location.port === '5173') && (
        <LMStudioLogsView token={token} />
      )}

      {/* Quick Register Confirmation Modal */}
      {registeringNode && (
        <div className="modal-overlay" onClick={() => setRegisteringNode(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '90%' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#fff' }}>Confirm Node Registration</h3>
              <button className="btn-icon" onClick={() => setRegisteringNode(null)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleConfirmRegisterNode} style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '14px' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                Specify details for registering the discovered node at <strong>{registeringNode.ip_address}:{registeringNode.port}</strong>.
              </p>
              
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Node Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  required 
                  value={registeringNode.node_name} 
                  onChange={e => setRegisteringNode({ ...registeringNode, node_name: e.target.value })} 
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Device Type</label>
                <select 
                  className="form-control" 
                  value={registeringNode.device_type} 
                  onChange={e => {
                    const newType = e.target.value;
                    const defaultName = `${newType.toUpperCase()} Node`;
                    setRegisteringNode({ 
                      ...registeringNode, 
                      device_type: newType,
                      node_name: registeringNode.node_name === `${registeringNode.device_type.toUpperCase()} Node` ? defaultName : registeringNode.node_name 
                    });
                  }}
                >
                  <option value="rpi-5-8gb">Raspberry Pi 5 (8GB)</option>
                  <option value="rpi-5-16gb">Raspberry Pi 5 (16GB)</option>
                  <option value="rpi-4-4gb">Raspberry Pi 4 (4GB+)</option>
                  <option value="rpi-zero-2w">Raspberry Pi Zero 2W</option>
                  <option value="esp32-wroom">ESP32 WROOM (WiFi)</option>
                  <option value="windows">Windows / PC</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setRegisteringNode(null)} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Register
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
