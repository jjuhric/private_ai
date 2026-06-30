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
});
