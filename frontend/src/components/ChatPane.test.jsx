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
    expect(mockHandleResolveCommand).toHaveBeenCalledWith('cmd_123', true);

    // Test Reject button click
    const rejectBtn = screen.getByText('Reject');
    fireEvent.click(rejectBtn);
    expect(mockHandleResolveCommand).toHaveBeenCalledWith('cmd_123', false);

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
  });
});
