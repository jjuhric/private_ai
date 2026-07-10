import React from 'react';
import { 
  Network, Cpu, Server, BookOpen, Calendar, Search, 
  FileText, GitBranch, Shield, Wrench, UserPlus, 
  Layers, Cloud, RefreshCw, Trophy, Newspaper, ExternalLink 
} from 'lucide-react';

const allAgents = [
  {
    type: 'communication_specialist',
    name: 'Communication Specialist',
    icon: RefreshCw,
    desc: 'Primary contact for the user. Bubbly, warm, and welcomes the user. Translates requests into project ideas and formats final reports beautifully.'
  },
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
    desc: 'Orchestrates software development pipelines, manages workspace files, writes source code, and deploys new custom tools.'
  },
  {
    type: 'sports',
    name: 'Sports Agent',
    icon: Trophy,
    desc: 'Gathers and tracks sports news, scores, highlights, or team articles from Bleacher Report, ensuring unseen stories are shown first.'
  },
  {
    type: 'news',
    name: 'News Agent',
    icon: Newspaper,
    desc: 'Gathers general news briefs from TMZ and performs randomized searches on user preference topics, evaluating accuracy results.'
  }
];

const matchesAgent = (agentType, activeAgentName) => {
  if (!activeAgentName) return false;
  const active = activeAgentName.toLowerCase();
  const type = agentType.toLowerCase();
  
  if (type === active) return true;
  if (active === 'weather_expert' && type === 'weather') return true;
  if (active === 'system_specialist' && type === 'system') return true;
  if (active === 'node_agent' && type === 'node') return true;
  if (active === 'memory_agent' && type === 'memory') return true;
  if (active === 'calendar_handler' && type === 'calendar') return true;
  if (active === 'web_searcher' && type === 'crawler') return true;
  if (active === 'document_vault' && type === 'rag') return true;
  if (active === 'github_agent' && type === 'github') return true;
  if (active === 'qa_engineer' && type === 'qa') return true;
  if (active === 'tool_creator_agent' && type === 'tool_creator') return true;
  if (active === 'agent_creator_agent' && type === 'agent_creator') return true;
  if (active === 'developer_agent' && type === 'developer') return true;
  if (active === 'sports_agent' && type === 'sports') return true;
  if (active === 'news_agent' && type === 'news') return true;

  return false;
};

export default function AgentDashboard({ activeAgent }) {
  const token = (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function')
    ? (localStorage.getItem('token') || '')
    : '';
  const monitorDashboardUrl = `http://${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}/monitor/?token=${encodeURIComponent(token)}`;
  const displayAddress = `${window.location.host}/monitor`;

  const sortedAgents = [...allAgents].sort((a, b) => {
    const aActive = matchesAgent(a.type, activeAgent);
    const bActive = matchesAgent(b.type, activeAgent);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return 0;
  });

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      {/* Header section with title and Standalone Monitor button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, margin: 0, background: 'linear-gradient(135deg, var(--text-primary) 30%, var(--accent-secondary) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Agent Dashboard
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px', margin: 0 }}>
            Real-time status and telemetry of all specialized AI agents in the network.
          </p>
        </div>
        <a 
          href={monitorDashboardUrl} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.9rem', textDecoration: 'none', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', borderRadius: '8px', color: '#fff', fontWeight: 600, boxShadow: '0 4px 15px rgba(139, 92, 246, 0.3)' }}
        >
          <ExternalLink size={16} /> Launch Standalone Monitor
        </a>
      </div>

      {/* Grid container for agent cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        {sortedAgents.map((agent) => {
          const isActive = matchesAgent(agent.type, activeAgent);
          const IconComponent = agent.icon;
          return (
            <div 
              key={agent.type} 
              style={{
                padding: '20px',
                background: isActive ? 'rgba(139, 92, 246, 0.15)' : 'var(--bg-glass)',
                border: isActive ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-glass)',
                borderRadius: '16px',
                boxShadow: isActive ? '0 0 20px rgba(139, 92, 246, 0.4)' : '0 4px 6px rgba(0,0,0,0.1)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* Highlight active agent tag */}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '4px 8px',
                  borderRadius: '12px',
                  boxShadow: '0 2px 8px rgba(139, 92, 246, 0.4)'
                }}>
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#fff',
                    display: 'inline-block',
                    animation: 'pulse 1.5s infinite'
                  }} />
                  ACTIVE
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: isActive ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isActive ? '#fff' : 'var(--text-secondary)',
                  boxShadow: isActive ? '0 0 10px rgba(139, 92, 246, 0.5)' : 'none'
                }}>
                  <IconComponent size={20} />
                </div>
                <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>
                  {agent.name}
                </div>
              </div>

              <div style={{
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.4,
                flexGrow: 1
              }}>
                {agent.desc}
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 400,
                borderTop: '1px solid rgba(255,255,255,0.05)',
                paddingTop: '10px',
                marginTop: '4px'
              }}>
                <span>Status:</span>
                <span>{isActive ? 'Processing...' : 'Idle'}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Standalone Agent Monitor Card for compatibility & Vitest tests */}
      <div className="memory-card" style={{ padding: '24px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', borderRadius: '16px', marginTop: 'auto' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
          Standalone Agent Monitor
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
          The Live Agent & Concurrency Dashboard has been decoupled into a lightweight standalone monitor application. You can launch it on a dedicated display or secondary monitor for real-time edge telemetry and agent pipeline visibility.
        </p>
        <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Running on: <code style={{ color: 'var(--accent-secondary)' }}>{displayAddress}</code>
        </div>
      </div>
      
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.5; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
