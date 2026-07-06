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
      { tool: 'host_machine', action: 'specs', agent: 'system_specialist' }
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
      'system_specialist'
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

  test('renders System Control subtab with mock telemetry data and triggers service restart', async () => {
    const alertSpy = vi.spyOn(global, 'alert').mockImplementation(() => {});
    const localMockFetch = vi.fn().mockImplementation(async (url, options) => {
      const urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
      if (urlStr.includes('/api/vault')) {
        return { ok: true, json: async () => [] };
      }
      if (urlStr.includes('/api/host/service/restart')) {
        if (options?.body?.includes('fail-service')) {
          return { ok: false, json: async () => ({ error: 'Service not found' }) };
        }
        if (options?.body?.includes('throw-service')) {
          return Promise.reject(new Error('Connection interrupted'));
        }
        return { ok: true, json: async () => ({ message: 'Service restarted successfully' }) };
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

    // Test restart service success path
    const restartBtn = screen.getByText('🔄 Restart Service');
    await act(async () => {
      fireEvent.click(restartBtn);
    });
    expect(alertSpy).toHaveBeenCalledWith('Service restarted successfully');

    // Test restart service fail path
    const serviceInput = screen.getByPlaceholderText('e.g. private-ai');
    fireEvent.change(serviceInput, { target: { value: 'fail-service' } });
    await act(async () => {
      fireEvent.click(restartBtn);
    });
    expect(alertSpy).toHaveBeenCalledWith('Failed to restart service: Service not found');

    // Test restart service throw path
    fireEvent.change(serviceInput, { target: { value: 'throw-service' } });
    await act(async () => {
      fireEvent.click(restartBtn);
    });
    expect(alertSpy).toHaveBeenCalledWith('Error restarting service: Connection interrupted');

    alertSpy.mockRestore();
  });

  test('manages Field Nodes registry tab list, add, delete, and alert errors', async () => {
    const alertSpy = vi.spyOn(global, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(global, 'confirm').mockImplementation(() => true);

    const localMockFetch = vi.fn().mockImplementation((url, options) => {
      const urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
      if (urlStr.includes('/api/nodes')) {
        if (options?.method === 'POST') {
          if (options.body.includes('fail-add')) {
            return Promise.resolve({ ok: false, json: async () => ({ error: 'Database constraint failed' }) });
          }
          if (options.body.includes('throw-add')) {
            return Promise.reject(new Error('Network disconnected'));
          }
          return Promise.resolve({ ok: true, json: async () => ({ success: true, id: 5 }) });
        }
        if (options?.method === 'DELETE') {
          if (urlStr.includes('/999')) {
            return Promise.reject(new Error('Network delete failure'));
          }
          return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        }
        // GET nodes
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, node_name: 'Living Room ESP', device_type: 'esp32-wroom', ip_address: '192.168.1.100', port: 80, is_online: 1, last_seen: '2026-07-04T00:00:00Z' },
            { id: 999, node_name: 'Living Room ESP 2', device_type: 'esp32-wroom', ip_address: '192.168.1.101', port: 80, is_online: 1, last_seen: '2026-07-04T00:00:00Z' }
          ]
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', localMockFetch);

    const { container } = render(<AgentDashboard token={token} toolLogs={[]} />);

    // Click Field Nodes tab
    await act(async () => {
      fireEvent.click(screen.getByText('Field Nodes'));
    });

    // Check node details rendered
    await waitFor(() => {
      expect(screen.getByText('Distributed Field Nodes')).toBeInTheDocument();
      expect(screen.getByText('Living Room ESP')).toBeInTheDocument();
      expect(screen.getByText('Living Room ESP 2')).toBeInTheDocument();
    });

    // Toggle Add Node Form
    fireEvent.click(screen.getByText('Add Node'));
    expect(screen.getByPlaceholderText('e.g. Living Room Pi')).toBeInTheDocument();

    // Fill form successfully
    fireEvent.change(screen.getByPlaceholderText('e.g. Living Room Pi'), { target: { value: 'Pi Zero Node' } });
    fireEvent.change(screen.getByPlaceholderText('192.168.1.50'), { target: { value: '192.168.1.55' } });
    fireEvent.change(screen.getByPlaceholderText('Optional Auth Token'), { target: { value: 'mypassword' } });

    // Select device type (to cover line 448 in AgentDashboard.jsx)
    const select = container.querySelector('form select');
    fireEvent.change(select, { target: { value: 'rpi-zero-2w' } });

    // Submit form successfully
    await act(async () => {
      fireEvent.submit(container.querySelector('form'));
    });

    expect(localMockFetch).toHaveBeenCalledWith('/api/nodes', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Pi Zero Node')
    }));

    // Test failed add node path (returns status not ok)
    fireEvent.click(screen.getByText('Add Node'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Living Room Pi'), { target: { value: 'fail-add' } });
    fireEvent.change(screen.getByPlaceholderText('192.168.1.50'), { target: { value: '192.168.1.55' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form'));
    });
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to add node: Database constraint failed'));

    // Test thrown error add node path
    fireEvent.change(screen.getByPlaceholderText('e.g. Living Room Pi'), { target: { value: 'throw-add' } });
    fireEvent.change(screen.getByPlaceholderText('192.168.1.50'), { target: { value: '192.168.1.55' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form'));
    });
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Error adding node: Network disconnected'));

    // Delete node success path (first row, node 1)
    const deleteButtons = container.querySelectorAll('button.btn-icon');
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });
    expect(localMockFetch).toHaveBeenCalledWith('/api/nodes/1', expect.objectContaining({
      method: 'DELETE'
    }));

    // Delete node error throw path (second row, node 999)
    await act(async () => {
      fireEvent.click(deleteButtons[1]);
    });
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Error deleting node: Network delete failure'));

    alertSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  test('handles network scan, install guide toggling, and quick register modal submit', async () => {
    const localMockFetch = vi.fn().mockImplementation((url, opts) => {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (urlStr.includes('/api/nodes/scan')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            nodes: [
              { ip_address: '192.168.1.227', port: 3000, device_type: 'windows', is_main_host: false }
            ]
          })
        });
      }
      if (urlStr.includes('/api/nodes') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true })
        });
      }
      // GET nodes
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([])
      });
    });
    vi.stubGlobal('fetch', localMockFetch);

    const { container } = render(
      <AgentDashboard token="my_token" toolLogs={[]} activeAgent={null} isStreaming={false} />
    );

    // Click Field Nodes tab
    fireEvent.click(screen.getByText('Field Nodes'));

    // 1. Toggle Install Guide
    fireEvent.click(screen.getByText('Install Guide'));
    expect(screen.getByText('Device Setup Walkthrough Guide')).toBeInTheDocument();
    
    // Toggle selector device guide
    const selectGuide = screen.getByRole('combobox');
    fireEvent.change(selectGuide, { target: { value: 'esp32' } });
    expect(screen.getByText(/Flash MicroPython/)).toBeInTheDocument();

    // 2. Click Scan LAN
    await act(async () => {
      fireEvent.click(screen.getByText('Scan LAN'));
    });

    // Check discovered node appears
    await waitFor(() => {
      expect(screen.getByText('192.168.1.227:3000')).toBeInTheDocument();
    });

    // 3. Click Quick Register
    fireEvent.click(screen.getByText('Quick Register'));
    expect(screen.getByText('Confirm Node Registration')).toBeInTheDocument();

    // Click Cancel to cover cancel branch
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Confirm Node Registration')).toBeNull();

    // Click Quick Register again
    fireEvent.click(screen.getByText('Quick Register'));
    expect(screen.getByText('Confirm Node Registration')).toBeInTheDocument();

    // Click close icon button (contains svg/X)
    const closeBtn = container.querySelector('.modal-header button');
    fireEvent.click(closeBtn);
    expect(screen.queryByText('Confirm Node Registration')).toBeNull();

    // Click Quick Register a third time to submit
    fireEvent.click(screen.getByText('Quick Register'));
    expect(screen.getByText('Confirm Node Registration')).toBeInTheDocument();

    // Select Device Type dropdown in register modal
    const modalSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(modalSelect, { target: { value: 'rpi-5-16gb' } });

    // Change node name input
    const modalNameInput = screen.getByDisplayValue('RPI-5-16GB Node');
    fireEvent.change(modalNameInput, { target: { value: 'My Living Room RPi' } });

    // Submit registration modal
    await act(async () => {
      fireEvent.submit(container.querySelector('.modal-content form'));
    });

    expect(localMockFetch).toHaveBeenCalledWith('/api/nodes', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('My Living Room RPi')
    }));

    // Verify modal closed
    expect(screen.queryByText('Confirm Node Registration')).toBeNull();
  });

  test('switches to token count tab and displays graphs, tables, and filters', async () => {
    const localMockFetch = vi.fn().mockImplementation((url) => {
      const urlStr = typeof url === 'string' ? url : (url && (url.url || url.toString())) || '';
      if (urlStr.includes('/api/token-usage')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totalTokens: 1024,
            tableData: [
              { model_name: 'gemini-2.0-flash', provider_type: 'online', total_tokens: 1024, call_count: 1 }
            ],
            graphData: [
              { created_at: '2026-07-06T10:00:00.000Z', model_name: 'gemini-2.0-flash', provider_type: 'online', token_count: 1024 }
            ]
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal('fetch', localMockFetch);
    console.log("global.fetch === localMockFetch:", global.fetch === localMockFetch);

    render(<AgentDashboard token={token} toolLogs={[]} />);

    // Click Show Token Count tab
    const tokenTabBtn = screen.getByText('Show Token Count');
    fireEvent.click(tokenTabBtn);

    // Verify KPI card and that fetch was triggered for default 24h
    await waitFor(() => {
      expect(localMockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/token-usage?timeframe=24h'), expect.any(Object));
      expect(screen.getAllByText(/1[.,]024|1024/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Overall Token Count')).toBeInTheDocument();
    });

    // Verify table content
    expect(screen.getByText('gemini-2.0-flash')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();

    // Switch timeframe filter to "Last Hour"
    const lastHourBtn = screen.getByText('Last Hour');
    fireEvent.click(lastHourBtn);

    // Check that fetch was triggered for 1h
    await waitFor(() => {
      expect(localMockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/token-usage?timeframe=1h'), expect.any(Object));
    });
  });
});
