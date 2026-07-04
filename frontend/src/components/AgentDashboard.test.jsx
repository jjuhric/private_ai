import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AgentDashboard from './AgentDashboard';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AgentDashboard Component Tests', () => {
  const token = 'fake-token';
  const defaultLogs = [
    { tool: 'query_vault', action: 'query', params: { query: 'test' } }
  ];

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
  });

  test('renders active agent grid registry and tool timeline', () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 1, filename: 'vault_doc.txt', file_size: 1024 }]
    });

    render(<AgentDashboard token={token} toolLogs={defaultLogs} />);

    expect(screen.getByText('Agent Network Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Supervisor Agent')).toBeInTheDocument();
    expect(screen.getByText('Document Vault Agent')).toBeInTheDocument();
    
    // Check that RAG agent status is shown as Active based on toolLogs input
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    
    // Check live routing timeline contains log entry
    expect(screen.getByText('[QUERY_VAULT]')).toBeInTheDocument();
  });

  test('switches tabs and lists indexed vault documents', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 10, filename: 'secret_specs.md', file_size: 2048 }]
    });

    render(<AgentDashboard token={token} toolLogs={[]} />);

    // Click Document Vault tab button
    const vaultTabBtn = screen.getByText('Document Vault (RAG)');
    fireEvent.click(vaultTabBtn);

    // Should render upload elements
    expect(screen.getByText('Add Document to RAG Vault')).toBeInTheDocument();

    // Verify document table contains loaded document
    await waitFor(() => {
      expect(screen.getByText('secret_specs.md')).toBeInTheDocument();
      expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    });
  });

  test('submits document upload successfully', async () => {
    mockFetch
      // First fetch: lists documents (empty initially)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => []
      })
      // Second fetch: submits index document POST
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })
      // Third fetch: updates list after upload
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 12, filename: 'uploaded_doc.txt', file_size: 512 }]
      });

    render(<AgentDashboard token={token} toolLogs={[]} />);

    // Switch to Vault tab
    fireEvent.click(screen.getByText('Document Vault (RAG)'));

    // Input values
    const nameInput = screen.getByPlaceholderText('document_name.txt');
    fireEvent.change(nameInput, { target: { value: 'uploaded_doc.txt' } });

    const contentInput = screen.getByPlaceholderText('Paste document text context here to parse and index...');
    fireEvent.change(contentInput, { target: { value: 'This is my text raw contents.' } });

    // Click upload
    const submitBtn = screen.getByText('Index Document');
    fireEvent.click(submitBtn);

    // Verify POST fetch was triggered and list refreshed
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(screen.getByText('uploaded_doc.txt')).toBeInTheDocument();
    });
  });

  test('deletes document when delete action is clicked', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 45, filename: 'doc_to_delete.txt', file_size: 100 }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => []
      });

    // Mock confirm dialog
    const confirmSpy = vi.spyOn(global, 'confirm').mockImplementation(() => true);

    const { container } = render(<AgentDashboard token={token} toolLogs={[]} />);

    fireEvent.click(screen.getByText('Document Vault (RAG)'));

    await waitFor(() => {
      expect(screen.getByText('doc_to_delete.txt')).toBeInTheDocument();
    });

    const deleteBtn = container.querySelector('button.btn-icon');
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
    
    confirmSpy.mockRestore();
  });

  test('handles file attachment loading raw text content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });

    const { container } = render(<AgentDashboard token={token} toolLogs={[]} />);
    fireEvent.click(screen.getByText('Document Vault (RAG)'));

    const fileInput = container.querySelector('input[type="file"]');
    const mockFile = new File(['mock content text'], 'attachment.txt', { type: 'text/plain' });

    // Trigger file load
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('attachment.txt')).toBeInTheDocument();
    });
  });

  test('clicks Agent Network tab button and simulates error paths during upload', async () => {
    // Mock upload failing (res.ok is false)
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => []
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Simulated upload error' })
      });

    render(<AgentDashboard token={token} toolLogs={[]} />);

    // 1. Click Agent Network tab to cover setActiveSubTab('network')
    fireEvent.click(screen.getByText('Agent Network'));

    // Switch back to Vault
    fireEvent.click(screen.getByText('Document Vault (RAG)'));

    // Input values for failing upload
    const nameInput = screen.getByPlaceholderText('document_name.txt');
    fireEvent.change(nameInput, { target: { value: 'fail_doc.txt' } });

    const contentInput = screen.getByPlaceholderText('Paste document text context here to parse and index...');
    fireEvent.change(contentInput, { target: { value: 'some content' } });

    fireEvent.click(screen.getByText('Index Document'));

    await waitFor(() => {
      expect(screen.getByText('Simulated upload error')).toBeInTheDocument();
    });

    // 2. Mock upload throw (network failure catch)
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByText('Index Document'));
    await waitFor(() => {
      expect(screen.getByText('Connection error while uploading.')).toBeInTheDocument();
    });
  });

  test('handles fetchDocuments failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Fetch failure'));
    render(<AgentDashboard token={token} toolLogs={[]} />);
    await vi.waitFor(() => {
      expect(screen.getByText('Agent Network Dashboard')).toBeInTheDocument();
    });
  });

  test('handles delete document failure gracefully', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 45, filename: 'doc_to_delete.txt', file_size: 100 }]
      })
      .mockRejectedValueOnce(new Error('Delete failure'));

    const confirmSpy = vi.spyOn(global, 'confirm').mockImplementation(() => true);
    const { container } = render(<AgentDashboard token={token} toolLogs={[]} />);
    fireEvent.click(screen.getByText('Document Vault (RAG)'));

    await waitFor(() => {
      expect(screen.getByText('doc_to_delete.txt')).toBeInTheDocument();
    });

    const deleteBtn = container.querySelector('button.btn-icon');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    confirmSpy.mockRestore();
  });

  test('renders active agent based on agent property in logs', () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const logs = [
      { tool: 'memory', action: 'recall', agent: 'memory_agent' },
      { tool: 'calendar', action: 'list', agent: 'calendar_handler' },
      { tool: 'search_web', action: 'query', agent: 'web_searcher' },
      { tool: 'query_vault', action: 'query', agent: 'document_vault' },
      { tool: 'read_file', action: 'read', agent: 'coder' },
      { tool: 'weather', action: 'forecast', agent: 'weather_expert' },
      { tool: 'host_machine', action: 'specs', agent: 'host_specialist' }
    ];
    render(<AgentDashboard token={token} toolLogs={logs} />);
    expect(screen.getByText('Agent Network Dashboard')).toBeInTheDocument();
  });

  test('handles empty upload validation error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    render(<AgentDashboard token={token} toolLogs={[]} />);
    fireEvent.click(screen.getByText('Document Vault (RAG)'));
    // Trigger submit directly on the form to bypass required validation blocker
    const form = screen.getByText('Index Document').closest('form');
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByText('Please specify a filename and enter some content.')).toBeInTheDocument();
    });
  });

  test('renders active agent based on tool fallback in logs when agent is missing', () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const logs = [
      { tool: 'memory', action: 'recall' },
      { tool: 'calendar', action: 'list' },
      { tool: 'search_web', action: 'query' },
      { tool: 'read_file', action: 'read' },
      { tool: 'weather', action: 'forecast' },
      { tool: 'host_machine', action: 'specs' }
    ];
    render(<AgentDashboard token={token} toolLogs={logs} />);
    expect(screen.getByText('Agent Network Dashboard')).toBeInTheDocument();
  });

  test('cycles through all possible activeAgent props to cover status branches', () => {
    const agentsToTest = [
      'supervisor',
      'memory_agent',
      'calendar_handler',
      'web_searcher',
      'document_vault',
      'coder',
      'qa_engineer',
      'weather_expert',
      'host_specialist'
    ];

    agentsToTest.forEach(agent => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      const { unmount } = render(
        <AgentDashboard token={token} toolLogs={[]} activeAgent={agent} isStreaming={true} />
      );
      expect(screen.getByText('Agent Network Dashboard')).toBeInTheDocument();
      unmount();
    });
  });

  test('renders System Control subtab with mock telemetry data', async () => {
    const localMockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
      if (urlStr.includes('/api/vault')) {
        return { ok: true, json: async () => [] };
      }
      if (urlStr.includes('/api/host/status')) {
        return {
          ok: true,
          json: async () => ({
            cpu: { model: 'ARM Cortex-A72', cores: 4, loadAvg: [0.1, 0.2, 0.3] },
            memory: { total: 1024, free: 512, used: 512, percentage: '50.0' },
            uptime: 3600,
            telemetry: {
              temperature: '45.0°C',
              power: 'Power readings',
              network: 'Network info'
            }
          })
        };
      }
      return { ok: false };
    });
    vi.stubGlobal('fetch', localMockFetch);

    render(<AgentDashboard token={token} toolLogs={[]} />);
    
    // Switch sub-tab
    await act(async () => {
      fireEvent.click(screen.getByText('System Control'));
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(localMockFetch).toHaveBeenCalledWith('/api/host/status', expect.any(Object));
    await waitFor(() => {
      expect(screen.getByText('CPU Specifications')).toBeInTheDocument();
      expect(screen.getByText(/ARM Cortex-A72/)).toBeInTheDocument();
      expect(screen.getByText(/4 Cores/)).toBeInTheDocument();
      expect(screen.getByText(/50.0% Used/)).toBeInTheDocument();
    });
  });
});
