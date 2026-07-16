import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentDashboard from './AgentDashboard';

describe('AgentDashboard Component Tests', () => {
  test('renders nodes list correctly', () => {
    const mockNodes = [
      { id: 1, node_name: 'Pi Node 1', device_type: 'RPi', ip_address: '192.168.1.100', port: 3000 }
    ];

    render(
      <AgentDashboard 
        nodes={mockNodes} 
        token="test-token" 
        handleDeleteNode={() => {}} 
        activeSubTab="nodes" 
      />
    );

    expect(screen.getByText('Pi Node 1')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.100:3000')).toBeInTheDocument();
  });
});
