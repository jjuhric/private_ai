import React, { useState, useEffect } from 'react';
import { Trash2, ExternalLink } from 'lucide-react';

export default function AgentDashboard({ nodes = [], token, handleDeleteNode, activeSubTab = 'nodes' }) {
  const [nodeHealthMap, setNodeHealthMap] = useState({});

  const performNodeHealthPoll = async (configuredNodes) => {
    const updatedHealth = { ...nodeHealthMap };
    
    await Promise.all(
      configuredNodes.map(async (node) => {
        try {
          let targetUrl;
          if (node.device_type === 'ESP32') {
            targetUrl = `http://${node.ip_address}:${node.port || 80}/health`;
          } else if (node.device_type === 'Google Assistant' || (node.device_type && node.device_type.includes('Google'))) {
            updatedHealth[node.id] = {
              status: 'online',
              dependencies: {
                llm_provider: 'stable',
                database: 'stable',
                mqtt_broker: 'stable'
              }
            };
            return;
          } else {
            targetUrl = `http://${node.ip_address}:${node.port}/api/bridge/health`;
          }

          const res = await fetch(targetUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (node.device_type === 'ESP32') {
              updatedHealth[node.id] = {
                status: data.ok ? 'online' : 'offline',
                dependencies: {
                  llm_provider: 'stable',
                  database: 'stable',
                  mqtt_broker: 'stable'
                }
              };
            } else {
              updatedHealth[node.id] = data;
            }
          } else {
            updatedHealth[node.id] = { status: 'offline', dependencies: {} };
          }
        } catch (err) {
          updatedHealth[node.id] = { status: 'offline', dependencies: {} };
        }
      })
    );
    setNodeHealthMap(updatedHealth);
  };

  useEffect(() => {
    if (activeSubTab === 'nodes' && nodes.length > 0) {
      performNodeHealthPoll(nodes); // Immediate bootstrap run
      
      const healthInterval = setInterval(() => {
        performNodeHealthPoll(nodes);
      }, 60000); // 1-minute tracking loops (Rule 5)
      
      return () => clearInterval(healthInterval);
    }
  }, [activeSubTab, nodes.length]);

  return (
    <div className="p-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: '#fff' }}>Agent Dashboard</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            Monitor and manage active network nodes.
          </p>
        </div>
        <a
          href="/monitor"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            fontSize: '0.9rem',
            textDecoration: 'none',
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            borderRadius: '10px',
            color: '#fff',
            fontWeight: 600,
            boxShadow: '0 4px 15px rgba(139, 92, 246, 0.25)'
          }}
        >
          <ExternalLink size={16} /> Launch Standalone Monitor
        </a>
      </div>
      {activeSubTab === 'nodes' && (
        <div className="overflow-x-auto w-full">
          <table className="table table-zebra w-full text-sm">
            <thead>
              <tr className="border-b border-base-300 text-left text-neutral-content">
                <th>Status</th>
                <th>Node Name</th>
                <th>Device Signature</th>
                <th>Network IP Address</th>
                <th>Health Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {nodes
                .filter(node => {
                  const health = nodeHealthMap[node.id];
                  if (health) {
                    return health.status === 'online';
                  }
                  return node.is_online === 1 || node.is_online === true;
                })
                .map(node => {
                  const health = nodeHealthMap[node.id];
                  const isOnline = health?.status === 'online' || node.is_online === 1;
                  
                  // Determine if the node is fully healthy
                  const isHealthy = isOnline && (
                    !health?.dependencies || (
                      health.dependencies.llm_provider === 'stable' &&
                      health.dependencies.database === 'stable' &&
                      health.dependencies.mqtt_broker === 'stable'
                    )
                  );
                  
                  return (
                    <tr key={node.id} className="border-b border-base-300">
                      <td>
                        <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-success shadow-lg' : 'bg-error'}`} />
                      </td>
                    <td className="font-bold">{node.node_name}</td>
                    <td>{node.device_type}</td>
                    <td>{node.ip_address}:{node.port}</td>
                    <td>
                      {health ? (
                        <span className={`px-2 py-1 rounded text-white font-semibold ${isHealthy ? 'bg-success' : 'bg-error'}`}>
                          {isHealthy ? 'Healthy' : 'Not Healthy'}
                        </span>
                      ) : (
                        <span className="text-neutral-content italic text-xs">Awaiting diagnostic sync...</span>
                      )}
                    </td>
                    <td className="text-right">
                      <button className="btn btn-ghost btn-sm text-error" onClick={() => handleDeleteNode(node.id)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
