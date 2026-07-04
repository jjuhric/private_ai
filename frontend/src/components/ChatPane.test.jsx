import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatPane from './ChatPane';

describe('ChatPane Component Tests', () => {
  const defaultProps = {
    messages: [
      { id: 1, role: 'user', content: 'hello' },
      { id: 2, role: 'assistant', content: 'hi there', thoughts: 'deep thought' }
    ],
    activeChatId: 1,
    isStreaming: false,
    streamThoughts: '',
    streamContent: '',
    toolLogs: [],
    inputText: 'Query',
    setInputText: vi.fn(),
    handleSendMessage: vi.fn(),
    messagesEndRef: React.createRef()
  };

  test('renders message lists and thoughts', () => {
    render(<ChatPane {...defaultProps} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('hi there')).toBeInTheDocument();
    expect(screen.getByText(/Agent Plan & Internal Thoughts/)).toBeInTheDocument();
  });

  test('renders welcome message and fires logo image onError fallback', () => {
    const { container, rerender } = render(<ChatPane {...defaultProps} messages={[]} />);
    expect(screen.getByText('Welcome to Private AI')).toBeInTheDocument();
    
    let img = container.querySelector('img');
    fireEvent.error(img);
    expect(img.src).toContain('placehold.co');

    // Test with activeChatId = null
    rerender(<ChatPane {...defaultProps} activeChatId={null} />);
    expect(screen.getByText('No Active Chat')).toBeInTheDocument();
    img = container.querySelector('img');
    fireEvent.error(img);
    expect(img.src).toContain('placehold.co');
  });

  test('renders streaming state with tool logs', () => {
    const logs = [
      { tool: 'calendar', action: 'list', params: {} },
      { tool: 'github', action: 'list_repos', params: {} },
      { tool: 'search_web', action: 'search', params: {} }
    ];

    render(
      <ChatPane 
        {...defaultProps} 
        isStreaming={true} 
        streamThoughts="thinking..." 
        streamContent="still writing"
        toolLogs={logs}
      />
    );

    expect(screen.getByText('thinking...')).toBeInTheDocument();
    expect(screen.getByText('still writing')).toBeInTheDocument();
    expect(screen.getByText('Running tool action: list ({})')).toBeInTheDocument();
    expect(screen.getByText('Running tool action: list_repos ({})')).toBeInTheDocument();
    expect(screen.getByText('Running tool action: search ({})')).toBeInTheDocument();
  });

  test('handles input field changes and form submit', () => {
    const mockSetInputText = vi.fn();
    const mockHandleSendMessage = vi.fn();

    render(
      <ChatPane 
        {...defaultProps} 
        setInputText={mockSetInputText}
        handleSendMessage={mockHandleSendMessage}
      />
    );

    const input = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(input, { target: { value: 'New Message' } });
    expect(mockSetInputText).toHaveBeenCalledWith('New Message');

    const form = screen.getByPlaceholderText('Send a message...').closest('form');
    fireEvent.submit(form);
    expect(mockHandleSendMessage).toHaveBeenCalled();
  });

  test('renders streaming state with empty streamContent (Thinking...)', () => {
    render(
      <ChatPane 
        {...defaultProps} 
        isStreaming={true} 
        streamThoughts="thinking..." 
        streamContent=""
      />
    );
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  test('renders pending and resolved command approvals', () => {
    const mockHandleResolveCommand = vi.fn();
    const logs = [
      {
        type: 'command_approval',
        commandId: 'cmd_123',
        command: 'npm run start',
        status: 'pending'
      }
    ];

    const { rerender } = render(
      <ChatPane 
        {...defaultProps} 
        isStreaming={true} 
        toolLogs={logs}
        handleResolveCommand={mockHandleResolveCommand}
      />
    );

    expect(screen.getByText('🛡️ Host Script Execution Request')).toBeInTheDocument();
    
    // Test Approve button click
    const approveBtn = screen.getByText('Approve');
    fireEvent.click(approveBtn);
    expect(mockHandleResolveCommand).toHaveBeenCalledWith('cmd_123', true, 'npm run start');

    // Test Reject button click
    const rejectBtn = screen.getByText('Reject');
    fireEvent.click(rejectBtn);
    expect(mockHandleResolveCommand).toHaveBeenCalledWith('cmd_123', false, 'npm run start');

    // Test resolved command approval state
    const resolvedLogs = [
      {
        type: 'command_approval',
        commandId: 'cmd_123',
        command: 'npm run start',
        status: 'approved'
      }
    ];

    rerender(
      <ChatPane 
        {...defaultProps} 
        isStreaming={true} 
        toolLogs={resolvedLogs}
        handleResolveCommand={mockHandleResolveCommand}
      />
    );

    expect(screen.getByText('Status: APPROVED')).toBeInTheDocument();

    // Test rejected command approval state
    const rejectedLogs = [
      {
        type: 'command_approval',
        commandId: 'cmd_123',
        command: 'npm run start',
        status: 'rejected'
      }
    ];

    rerender(
      <ChatPane 
        {...defaultProps} 
        isStreaming={true} 
        toolLogs={rejectedLogs}
        handleResolveCommand={mockHandleResolveCommand}
      />
    );

    expect(screen.getByText('Status: REJECTED')).toBeInTheDocument();
  });

  test('renders command approval with safety analysis details', () => {
    const logs = [
      {
        type: 'command_approval',
        commandId: 'cmd_123',
        command: 'rm -rf /tmp/cache',
        status: 'pending',
        safety_analysis: {
          risk_level: 'high',
          reason: 'Clears the temporary cache directory.',
          potential_harm: 'Destructive deletion of files under /tmp/cache.',
          recommendation: 'review_carefully'
        }
      }
    ];

    render(
      <ChatPane 
        {...defaultProps} 
        isStreaming={true} 
        toolLogs={logs}
      />
    );

    expect(screen.getByText('HIGH RISK')).toBeInTheDocument();
    expect(screen.getByText('Clears the temporary cache directory.')).toBeInTheDocument();
    expect(screen.getByText('Destructive deletion of files under /tmp/cache.')).toBeInTheDocument();
    expect(screen.getByText('REVIEW CAREFULLY')).toBeInTheDocument();
  });

  test('clicking starter chips updates input text', () => {
    const mockSetInputText = vi.fn();
    render(<ChatPane {...defaultProps} messages={[]} setInputText={mockSetInputText} />);
    
    // Find one of the chips
    const chip = screen.getByText('Check host CPU temperature & RAM specs');
    fireEvent.click(chip);
    expect(mockSetInputText).toHaveBeenCalledWith(
      'Can you inspect my computer specifications, thermal temperature, and battery telemetry?'
    );
  });

  test('changing command input updates the command value', () => {
    const logs = [
      {
        type: 'command_approval',
        commandId: 'cmd_123',
        command: 'npm run start',
        status: 'pending'
      }
    ];

    render(
      <ChatPane 
        {...defaultProps} 
        isStreaming={true} 
        toolLogs={logs}
      />
    );

    const input = screen.getByDisplayValue('npm run start');
    fireEvent.change(input, { target: { value: 'npm run test' } });
    expect(input.value).toBe('npm run test');
  });

  test('clicking stop button calls handleStop', () => {
    const mockHandleStop = vi.fn();
    render(
      <ChatPane 
        {...defaultProps} 
        isStreaming={true} 
        handleStop={mockHandleStop}
      />
    );

    const stopBtn = screen.getByTitle('Stop generating');
    fireEvent.click(stopBtn);
    expect(mockHandleStop).toHaveBeenCalledTimes(1);
  });
});
