import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsModal from './SettingsModal';

describe('SettingsModal Component Tests', () => {
  const defaultSettings = {
    provider: 'local',
    model_name: 'google/gemma-4-e4b',
    github_token: 'git_token',
    local_key: 'local_pwd',
    local_url: 'http://localhost:1234/v1',
    local_api_style: 'openai',
    online_url: '',
    online_key: '',
    online_provider: 'gemini'
  };

  const defaultProps = {
    isSettingsOpen: true,
    setIsSettingsOpen: vi.fn(),
    settings: defaultSettings,
    setSettings: vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(defaultSettings);
      }
    }),
    localModels: ['google/gemma-4-e4b', 'google/gemma-4-e2b'],
    onlineModels: ['gemini-2.5-flash', 'gpt-4o', 'claude-3-5-sonnet-latest'],
    saveSettings: vi.fn(),
    showLocalKey: false,
    setShowLocalKey: vi.fn(),
    showOnlineKey: false,
    setShowOnlineKey: vi.fn(),
    showGithubToken: false,
    setShowGithubToken: vi.fn()
  };

  test('does not render when closed', () => {
    const { container } = render(<SettingsModal {...defaultProps} isSettingsOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders Local LLM panel inputs and switches to Online LLM tab under different providers', () => {
    const mockSetSettings = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(defaultSettings);
      }
    });

    const { unmount } = render(<SettingsModal {...defaultProps} setSettings={mockSetSettings} />);
    const onlineTabBtn = screen.getByText('Online Gemini');
    fireEvent.click(onlineTabBtn);
    expect(mockSetSettings).toHaveBeenCalled();
    unmount();

    // Rerender with provider: local and online_provider: openai
    const settingsOpenAI = {
      ...defaultSettings,
      provider: 'local',
      online_provider: 'openai'
    };
    const { unmount: unmountOpenAI } = render(
      <SettingsModal 
        {...defaultProps} 
        settings={settingsOpenAI}
        setSettings={mockSetSettings}
      />
    );
    const onlineTabBtnOpenAI = screen.getByText('Online Gemini');
    fireEvent.click(onlineTabBtnOpenAI);
    expect(mockSetSettings).toHaveBeenCalled();
    unmountOpenAI();

    // Rerender with provider: local and online_provider: anthropic
    const settingsAnth = {
      ...defaultSettings,
      provider: 'local',
      online_provider: 'anthropic'
    };
    const { unmount: unmountAnth } = render(
      <SettingsModal 
        {...defaultProps} 
        settings={settingsAnth}
        setSettings={mockSetSettings}
      />
    );
    const onlineTabBtnAnth = screen.getByText('Online Gemini');
    fireEvent.click(onlineTabBtnAnth);
    expect(mockSetSettings).toHaveBeenCalled();
    unmountAnth();
  });

  test('modifies Local LLM settings fields and local key toggler', () => {
    const mockSetSettings = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(defaultSettings);
      }
    });
    const mockSetShowLocalKey = vi.fn();

    const { container } = render(
      <SettingsModal 
        {...defaultProps} 
        setSettings={mockSetSettings}
        setShowLocalKey={mockSetShowLocalKey}
      />
    );

    // Style dropdown select
    const select = container.querySelector('select');
    fireEvent.change(select, { target: { value: 'lm-studio' } });
    expect(mockSetSettings).toHaveBeenCalled();

    // Local model select dropdown
    const modelSelect = container.querySelectorAll('select')[1];
    fireEvent.change(modelSelect, { target: { value: 'google/gemma-4-e2b' } });
    expect(mockSetSettings).toHaveBeenCalled();

    // Local Base URL text input
    const urlInput = screen.getByPlaceholderText('e.g. http://192.168.1.42:1234/v1');
    fireEvent.change(urlInput, { target: { value: 'http://localhost:5000/v1' } });
    expect(mockSetSettings).toHaveBeenCalled();

    // Local API token input
    const tokenInput = screen.getByPlaceholderText('Enter local API token if required');
    fireEvent.change(tokenInput, { target: { value: 'new_local_key' } });
    expect(mockSetSettings).toHaveBeenCalled();

    // Click local key visibility toggler button
    const localKeyToggler = container.querySelector('.form-group button[type="button"]');
    fireEvent.click(localKeyToggler);
    expect(mockSetShowLocalKey).toHaveBeenCalled();
  });

  test('modifies Local LLM settings fields - empty local models list fallback', () => {
    const mockSetSettings = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(defaultSettings);
      }
    });

    render(
      <SettingsModal 
        {...defaultProps} 
        setSettings={mockSetSettings}
        localModels={[]}
      />
    );

    // Should render local model text input instead of select
    const modelTextInput = screen.getByPlaceholderText('e.g. google/gemma-4-e4b');
    fireEvent.change(modelTextInput, { target: { value: 'llama3-local' } });
    expect(mockSetSettings).toHaveBeenCalled();
  });

  test('renders all online provider model selections', () => {
    const mockSetSettings = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(defaultSettings);
      }
    });

    const providers = ['gemini', 'openai', 'anthropic', 'custom'];
    providers.forEach(p => {
      const settings = {
        ...defaultSettings,
        provider: 'gemini',
        online_provider: p,
        online_key: 'key',
        model_name: p === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gemini-2.5-flash'
      };
      const { unmount } = render(
        <SettingsModal 
          {...defaultProps} 
          settings={settings}
          setSettings={mockSetSettings}
          onlineModels={[]}
        />
      );
      unmount();
    });
  });

  test('modifies online provider selections and switches to local tab', () => {
    const mockSetSettings = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(onlineSettings);
      }
    });

    const onlineSettings = {
      ...defaultSettings,
      provider: 'gemini',
      online_provider: 'gemini',
      model_name: 'gpt-4o'
    };

    const { container } = render(
      <SettingsModal 
        {...defaultProps} 
        settings={onlineSettings}
        setSettings={mockSetSettings}
      />
    );

    // Switch online provider to openai
    const select = container.querySelector('select');
    fireEvent.change(select, { target: { value: 'openai' } });
    expect(mockSetSettings).toHaveBeenCalled();

    // Switch online provider to anthropic
    fireEvent.change(select, { target: { value: 'anthropic' } });
    expect(mockSetSettings).toHaveBeenCalled();

    // Click Local LLM tab
    const localTabBtn = screen.getByText('Local LLM');
    fireEvent.click(localTabBtn);
    expect(mockSetSettings).toHaveBeenCalled();
  });

  test('modifies Online LLM settings fields - Custom / OpenAI model list fallback', () => {
    const mockSetSettings = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(onlineSettings);
      }
    });

    const onlineSettings = {
      ...defaultSettings,
      provider: 'gemini',
      online_provider: 'custom',
      online_url: 'https://custom-provider/v1',
      online_key: 'custom_key'
    };

    render(
      <SettingsModal 
        {...defaultProps} 
        settings={onlineSettings}
        setSettings={mockSetSettings}
        onlineModels={[]} // Empty list to force custom text input field
      />
    );

    // Custom model text input field instead of select dropdown
    const customModelInput = screen.getByPlaceholderText('Enter model name');
    fireEvent.change(customModelInput, { target: { value: 'llama3' } });
    expect(mockSetSettings).toHaveBeenCalled();
  });

  test('modifies Online LLM settings fields - OpenAI Base URL and Key', () => {
    const mockSetSettings = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(onlineSettings);
      }
    });

    const onlineSettings = {
      ...defaultSettings,
      provider: 'gemini',
      online_provider: 'openai',
      online_url: 'https://api.openai.com/v1',
      online_key: 'op_key'
    };

    const { container } = render(
      <SettingsModal 
        {...defaultProps} 
        settings={onlineSettings}
        setSettings={mockSetSettings}
      />
    );

    // Online Model Name dropdown select
    const modelSelect = container.querySelectorAll('select')[1];
    fireEvent.change(modelSelect, { target: { value: 'gpt-4o-mini' } });
    expect(mockSetSettings).toHaveBeenCalled();

    // Online base URL custom endpoint input
    const urlInput = screen.getByPlaceholderText('e.g. https://api.openai.com/v1');
    fireEvent.change(urlInput, { target: { value: 'https://custom-provider/v1' } });
    expect(mockSetSettings).toHaveBeenCalled();

    // Online API key input
    const keyInput = screen.getByPlaceholderText('Enter provider API key');
    fireEvent.change(keyInput, { target: { value: 'new_online_key' } });
    expect(mockSetSettings).toHaveBeenCalled();
  });

  test('toggles key/token field visibility inputs and triggers save', () => {
    const mockSetShowLocalKey = vi.fn();
    const mockSetShowOnlineKey = vi.fn();
    const mockSetShowGithubToken = vi.fn();
    const mockSetSettings = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(onlineSettings);
      }
    });
    const mockSaveSettings = vi.fn();

    const onlineSettings = {
      ...defaultSettings,
      provider: 'gemini',
      online_provider: 'openai'
    };

    const { container } = render(
      <SettingsModal 
        {...defaultProps} 
        settings={onlineSettings}
        setSettings={mockSetSettings}
        setShowLocalKey={mockSetShowLocalKey}
        setShowOnlineKey={mockSetShowOnlineKey}
        setShowGithubToken={mockSetShowGithubToken}
        saveSettings={mockSaveSettings}
      />
    );

    // Change GitHub token input
    const gitTokenInput = screen.getByPlaceholderText('ghp_...');
    fireEvent.change(gitTokenInput, { target: { value: 'new_git_token' } });
    expect(mockSetSettings).toHaveBeenCalled();

    // Toggle local key visibility, online key visibility, github token visibility buttons
    const buttons = container.querySelectorAll('.form-group button[type="button"]');
    
    // Toggle online key (first button inside the relative inputs)
    fireEvent.click(buttons[0]);
    expect(mockSetShowOnlineKey).toHaveBeenCalled();

    // Toggle github token (second button)
    fireEvent.click(buttons[1]);
    expect(mockSetShowGithubToken).toHaveBeenCalled();

    // Save button click
    const saveBtn = screen.getByText('Save Configuration');
    fireEvent.click(saveBtn);
    expect(mockSaveSettings).toHaveBeenCalled();
  });

  test('modal close triggers', () => {
    const mockSetIsSettingsOpen = vi.fn();
    const { container } = render(
      <SettingsModal 
        {...defaultProps} 
        setIsSettingsOpen={mockSetIsSettingsOpen}
      />
    );

    const overlay = container.querySelector('.modal-overlay');
    fireEvent.click(overlay);
    expect(mockSetIsSettingsOpen).toHaveBeenCalledWith(false);

    const closeBtn = container.querySelector('.modal-header button');
    fireEvent.click(closeBtn);
    expect(mockSetIsSettingsOpen).toHaveBeenCalledTimes(2);
  });

  test('renders Online LLM panel when provider is online and online_provider is anthropic', () => {
    const settingsOnlineAnthropic = {
      ...defaultSettings,
      provider: 'online',
      online_provider: 'anthropic'
    };

    render(
      <SettingsModal 
        {...defaultProps} 
        settings={settingsOnlineAnthropic}
      />
    );

    const selectEl = screen.getByDisplayValue('Anthropic');
    expect(selectEl).toBeInTheDocument();
  });

  test('renders with all visibility toggles set to true', () => {
    const props = {
      ...defaultProps,
      showLocalKey: true,
      showOnlineKey: true,
      showGithubToken: true
    };
    render(<SettingsModal {...props} />);
    expect(screen.getByText('GitHub Integration')).toBeInTheDocument();
  });

  test('closes modal on Escape keydown', () => {
    const mockSetIsSettingsOpen = vi.fn();
    render(
      <SettingsModal 
        {...defaultProps} 
        isSettingsOpen={true}
        setIsSettingsOpen={mockSetIsSettingsOpen}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockSetIsSettingsOpen).toHaveBeenCalledWith(false);
  });

  test('changes Supervisor Model Override option', () => {
    const mockSetSettings = vi.fn();
    const onlineSettings = {
      ...defaultSettings,
      provider: 'gemini'
    };
    render(
      <SettingsModal 
        {...defaultProps} 
        settings={onlineSettings}
        isSettingsOpen={true}
        setSettings={mockSetSettings}
      />
    );
    
    // Select the select element next to the label
    const selects = screen.getAllByRole('combobox');
    const overrideSelect = selects[selects.length - 1];
    fireEvent.change(overrideSelect, { target: { value: 'gemini-2.5-pro' } });
    expect(mockSetSettings).toHaveBeenCalled();
  });
});
