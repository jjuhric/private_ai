import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LMStudioLogsView from './LMStudioLogsView';

class MockEventSource {
  constructor(url) {
    this.url = url;
    MockEventSource.instance = this;
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 10);
  }
  close() {
    MockEventSource.closed = true;
  }
}

describe('LMStudioLogsView Component Tests', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('alert', vi.fn());
    MockEventSource.instance = null;
    MockEventSource.closed = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders with default state and establishes SSE stream', async () => {
    render(<LMStudioLogsView token="mock-token" />);
    expect(screen.getByText('LM Studio Log Stream')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Live log stream connection established/)).toBeInTheDocument();
    });
  });

  test('opening dynamic emergency modal on Clear Logs and canceling', async () => {
    render(<LMStudioLogsView token="mock-token" />);
    const clearBtn = screen.getByRole('button', { name: /clear logs/i });
    fireEvent.click(clearBtn);

    expect(screen.getByText('Emergency Interaction Required')).toBeInTheDocument();
    expect(screen.getByText(/Wipe all local LM Studio logs/)).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Emergency Interaction Required')).toBeNull();
  });

  test('clicking Stop Stream opens modal and disconnects EventSource on confirmation', async () => {
    render(<LMStudioLogsView token="mock-token" />);
    
    await waitFor(() => {
      expect(screen.getByText(/Live log stream connection established/)).toBeInTheDocument();
    });

    const stopBtn = screen.getByRole('button', { name: /stop/i });
    fireEvent.click(stopBtn);

    expect(screen.getByText('Emergency Interaction Required')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to terminate the active log collection stream/)).toBeInTheDocument();

    const yesBtn = screen.getByRole('button', { name: /yes, stop stream/i });
    fireEvent.click(yesBtn);

    expect(screen.queryByText('Emergency Interaction Required')).toBeNull();
    expect(MockEventSource.closed).toBe(true);
    expect(screen.getByText(/Live log stream stopped by user request/)).toBeInTheDocument();
  });

  test('clicking Eject Model opens modal and triggers API on confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Model ejected successfully.' })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LMStudioLogsView token="mock-token" />);
    const ejectBtn = screen.getByRole('button', { name: /eject/i });
    fireEvent.click(ejectBtn);

    expect(screen.getByText('Emergency Interaction Required')).toBeInTheDocument();
    expect(screen.getByText(/Eject the currently loaded local model/)).toBeInTheDocument();

    const yesBtn = screen.getByRole('button', { name: /yes, eject model/i });
    fireEvent.click(yesBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/lmstudio/eject-model', expect.any(Object));
    });
  });
});
