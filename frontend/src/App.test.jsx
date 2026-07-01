import React from 'react';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import App from './App';

// Mock scrollIntoView in JSDOM environment
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock localStorage globally
const mockLocalStorage = {
  getItem: vi.fn().mockReturnValue('mock_token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};
global.localStorage = mockLocalStorage;

// Mock global fetch in Vitest
global.fetch = vi.fn().mockImplementation((url, options) => {
  const urlStr = String(url);

  if (urlStr.includes('/api/auth/me')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ user: { username: 'appuser' } })
    });
  }

  if (urlStr.includes('/api/settings/local-models')) {
    return Promise.resolve({
      ok: true,
      json: async () => ['local-gemma']
    });
  }

  if (urlStr.includes('/api/settings/online-models')) {
    return Promise.resolve({
      ok: true,
      json: async () => ['gemini-2.5-flash']
    });
  }

  if (urlStr.includes('/api/settings')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        user_id: 1,
        provider: 'local',
        model_name: 'local-gemma',
        github_token: '',
        local_key: '',
        local_url: 'http://localhost:1234/v1',
        local_api_style: 'openai',
        online_url: '',
        online_key: '',
        online_provider: 'gemini'
      })
    });
  }

  if (urlStr.includes('/messages')) {
    return Promise.resolve({
      ok: true,
      json: async () => []
    });
  }

  if (urlStr.includes('/api/chats')) {
    if (options && options.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: 2, title: 'Chat 12:00 AM', chatId: 2 })
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => [{ id: 1, title: 'App Chat One' }]
    });
  }

  if (urlStr.includes('/api/calendar')) {
    return Promise.resolve({
      ok: true,
      json: async () => []
    });
  }

  if (urlStr.includes('/api/profile')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        name: 'App User Name',
        zipcode: '32421',
        country: 'US',
        temp_unit: 'imperial',
        weather_api_key: ''
      })
    });
  }

  return Promise.resolve({
    ok: true,
    json: async () => ({})
  });
});

describe('Main App Component Tests', () => {
  test('renders authenticated main workspace layout successfully', async () => {
    // Render under act to handle state updates from useEffect API fetches
    let rendered;
    await act(async () => {
      rendered = render(<App />);
    });

    // Sidebar renders app logo title and username
    expect(screen.getByText('Private AI')).toBeInTheDocument();
    expect(screen.getByText('👤 appuser')).toBeInTheDocument();
    expect(screen.getByText('App Chat One')).toBeInTheDocument();
  });
});
