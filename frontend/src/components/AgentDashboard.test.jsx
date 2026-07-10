import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentDashboard from './AgentDashboard';

describe('AgentDashboard Component Tests', () => {
  beforeEach(() => {
    // Mock window.location
    vi.stubGlobal('location', {
      hostname: 'localhost',
      port: '3000',
      host: 'localhost:3000'
    });
  });

  test('renders Standalone Agent Monitor header and launcher card', () => {
    render(<AgentDashboard />);

    expect(screen.getByText('Standalone Agent Monitor')).toBeInTheDocument();
    expect(screen.getByText(/The Live Agent & Concurrency Dashboard has been decoupled/)).toBeInTheDocument();
    
    const launchLink = screen.getByText('Launch Standalone Monitor');
    expect(launchLink).toBeInTheDocument();
    expect(launchLink).toHaveAttribute('href', 'http://localhost:3000/monitor/?token=');
  });

  test('safely handles token inclusion when localStorage is available', () => {
    // Mock localStorage
    const mockLocalStorage = {
      getItem: vi.fn().mockReturnValue('mocked-jwt-token')
    };
    vi.stubGlobal('localStorage', mockLocalStorage);

    render(<AgentDashboard />);

    const launchLink = screen.getByText('Launch Standalone Monitor');
    expect(launchLink).toHaveAttribute('href', 'http://localhost:3000/monitor/?token=mocked-jwt-token');
    
    vi.unstubAllGlobals();
  });
});
