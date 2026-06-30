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
    const { container } = render(<ChatPane {...defaultProps} messages={[]} />);
    expect(screen.getByText('Welcome to Private AI')).toBeInTheDocument();
    
    const img = container.querySelector('img');
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
});
