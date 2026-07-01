import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from './Sidebar';

describe('Sidebar Component Tests', () => {
  const defaultProps = {
    user: { username: 'testuser' },
    chats: [
      { id: 1, title: 'Chat One' },
      { id: 2, title: 'Chat Two' }
    ],
    activeChatId: 1,
    setActiveChatId: vi.fn(),
    activeTab: 'chat',
    setActiveTab: vi.fn(),
    isMobileSidebarOpen: false,
    setIsMobileSidebarOpen: vi.fn(),
    editingChatId: null,
    setEditingChatId: vi.fn(),
    editingTitle: '',
    setEditingTitle: vi.fn(),
    createChat: vi.fn(),
    deleteChat: vi.fn(),
    handleRenameChat: vi.fn(),
    handleLogout: vi.fn(),
    setIsSettingsOpen: vi.fn(),
    setIsProfileOpen: vi.fn(),
    appVersion: '1.1.0'
  };

  test('renders user profile avatar block and chat list', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('👤 testuser')).toBeInTheDocument();
    expect(screen.getByText('Chat One')).toBeInTheDocument();
    expect(screen.getByText('Chat Two')).toBeInTheDocument();
  });

  test('triggers createChat on clicking New Chat button', () => {
    render(<Sidebar {...defaultProps} />);
    const newChatBtn = screen.getByText('New Chat');
    fireEvent.click(newChatBtn);
    expect(defaultProps.createChat).toHaveBeenCalled();
  });

  test('triggers setActiveTab when calendar button is clicked', () => {
    render(<Sidebar {...defaultProps} />);
    const calendarBtn = screen.getByText('My Calendar');
    fireEvent.click(calendarBtn);
    expect(defaultProps.setActiveTab).toHaveBeenCalledWith('calendar');
  });

  test('triggers setIsProfileOpen when clicking profile display', () => {
    render(<Sidebar {...defaultProps} />);
    const profileSpan = screen.getByText('👤 testuser');
    fireEvent.click(profileSpan);
    expect(defaultProps.setIsProfileOpen).toHaveBeenCalledWith(true);
  });

  test('triggers edit state, rename triggers, cancellations, and change propagation', () => {
    const mockSetEditingChatId = vi.fn();
    const mockSetEditingTitle = vi.fn();
    const mockHandleRenameChat = vi.fn();

    const { container, rerender } = render(
      <Sidebar 
        {...defaultProps} 
        setEditingChatId={mockSetEditingChatId}
        setEditingTitle={mockSetEditingTitle}
      />
    );

    const chatItem = container.querySelector('.chat-item.active');
    const buttons = chatItem.querySelectorAll('button');
    // First button inside the chat item is the Edit button
    fireEvent.click(buttons[0]);
    expect(mockSetEditingChatId).toHaveBeenCalledWith(1);
    expect(mockSetEditingTitle).toHaveBeenCalledWith('Chat One');

    // Rerender in editing state
    rerender(
      <Sidebar 
        {...defaultProps} 
        editingChatId={1}
        editingTitle="New Title"
        setEditingChatId={mockSetEditingChatId}
        setEditingTitle={mockSetEditingTitle}
        handleRenameChat={mockHandleRenameChat}
      />
    );

    const renameInput = screen.getByDisplayValue('New Title');
    expect(renameInput).toBeInTheDocument();

    // Change title
    fireEvent.change(renameInput, { target: { value: 'Different Title' } });

    // Click input should stop propagation
    fireEvent.click(renameInput);

    // Trigger Enter key
    fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(mockHandleRenameChat).toHaveBeenCalledWith(1, 'New Title');

    // Trigger Escape key
    fireEvent.keyDown(renameInput, { key: 'Escape' });
    expect(mockSetEditingChatId).toHaveBeenCalledWith(null);

    // Trigger blur
    fireEvent.blur(renameInput);
    expect(mockHandleRenameChat).toHaveBeenCalledTimes(2);
  });

  test('triggers chat deletion, settings toggle, mobile close, and logout', () => {
    const mockDeleteChat = vi.fn();
    const mockHandleLogout = vi.fn();
    const mockSetIsSettingsOpen = vi.fn();
    const mockSetIsMobileSidebarOpen = vi.fn();

    const { container } = render(
      <Sidebar 
        {...defaultProps} 
        isMobileSidebarOpen={true}
        setIsMobileSidebarOpen={mockSetIsMobileSidebarOpen}
        deleteChat={mockDeleteChat}
        handleLogout={mockHandleLogout}
        setIsSettingsOpen={mockSetIsSettingsOpen}
      />
    );

    // Click mobile close button (in header close block)
    const mobileCloseBtn = container.querySelector('.btn-icon');
    fireEvent.click(mobileCloseBtn);
    expect(mockSetIsMobileSidebarOpen).toHaveBeenCalledWith(false);

    const chatItem = container.querySelector('.chat-item.active');
    const buttons = chatItem.querySelectorAll('button');
    // Second button inside chat-item is delete button
    fireEvent.click(buttons[1]);
    expect(mockDeleteChat).toHaveBeenCalled();

    const userProfile = container.querySelector('.user-profile');
    const userButtons = userProfile.querySelectorAll('button');
    // First user footer button is Settings
    fireEvent.click(userButtons[0]);
    expect(mockSetIsSettingsOpen).toHaveBeenCalledWith(true);

    // Second user footer button is Logout
    fireEvent.click(userButtons[1]);
    expect(mockHandleLogout).toHaveBeenCalled();
  });

  test('covers logo image error and AI Memory click', () => {
    const mockSetIsMobileSidebarOpen = vi.fn();
    const { container } = render(
      <Sidebar 
        {...defaultProps} 
        isMobileSidebarOpen={true}
        setIsMobileSidebarOpen={mockSetIsMobileSidebarOpen}
      />
    );

    // 1. Logo onError
    const logoImg = container.querySelector('.sidebar-logo');
    fireEvent.error(logoImg);
    expect(logoImg.src).toContain('placehold.co');

    // 2. AI Memory click
    const memoryBtn = screen.getByText('AI Memory');
    fireEvent.click(memoryBtn);
    expect(defaultProps.setActiveTab).toHaveBeenCalledWith('memory');
    expect(mockSetIsMobileSidebarOpen).toHaveBeenCalledWith(false);
  });
});
