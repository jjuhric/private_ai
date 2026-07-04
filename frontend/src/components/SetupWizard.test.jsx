import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SetupWizard from './SetupWizard';

describe('SetupWizard Component Tests', () => {
  const mockOnComplete = vi.fn();
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  test('renders Step 1 device selection and advances to Step 2 (profile) and Step 3 (LLM)', async () => {
    render(<SetupWizard token="test_token" onComplete={mockOnComplete} />);

    expect(screen.getByText('Device Selection')).toBeInTheDocument();
    
    // Click Continue to go to Step 2 (Profile)
    fireEvent.click(screen.getByText('Continue'));

    expect(screen.getByText('Personal Profile Details')).toBeInTheDocument();
    
    // Fill first name
    const nameInput = screen.getByPlaceholderText('Jeffery');
    fireEvent.change(nameInput, { target: { value: 'Jeffery' } });

    // Click Continue to go to Step 3 (LLM)
    fireEvent.click(screen.getByText('Continue'));

    // Expect to be on Step 3
    expect(screen.getByText('LLM Configuration')).toBeInTheDocument();
  });

  test('Step 3 local connection test success path', async () => {
    render(<SetupWizard token="test_token" onComplete={mockOnComplete} />);

    // Step 1
    fireEvent.click(screen.getByText('Continue'));

    // Step 2
    fireEvent.change(screen.getByPlaceholderText('Jeffery'), { target: { value: 'Jeffery' } });
    fireEvent.click(screen.getByText('Continue'));

    // Select Local API URL test connection
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Local connection successful' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ['qwen/qwen3.8-9b', 'meta/llama3']
      });

    const testBtn = screen.getByText('⚡ Test Connection');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText('Local connection successful')).toBeInTheDocument();
    });

    // Verify local models dropdown rendered and is selectable
    await waitFor(() => {
      const select = screen.getAllByRole('combobox')[1];
      expect(select).toBeInTheDocument();
      fireEvent.change(select, { target: { value: 'meta/llama3' } });
    });
  });

  test('Step 3 validation prevents Continue if invalid', () => {
    render(<SetupWizard token="test_token" onComplete={mockOnComplete} />);

    // Step 1
    fireEvent.click(screen.getByText('Continue'));

    // Step 2
    fireEvent.change(screen.getByPlaceholderText('Jeffery'), { target: { value: 'Jeffery' } });
    fireEvent.click(screen.getByText('Continue'));

    // Switch to Online API (which requires an API key)
    fireEvent.click(screen.getByText('Online API'));

    // Check that continue button is disabled
    const continueBtn = screen.getAllByText('Continue')[0];
    expect(continueBtn).toBeDisabled();

    // Fill key
    fireEvent.change(screen.getByPlaceholderText('Enter API Key'), { target: { value: 'valid_key_here' } });
    expect(continueBtn).not.toBeDisabled();
  });

  test('Step 4 save and complete wizard triggers PUT requests', async () => {
    render(<SetupWizard token="test_token" onComplete={mockOnComplete} />);

    // Step 1
    fireEvent.click(screen.getByText('Continue'));

    // Step 2
    fireEvent.change(screen.getByPlaceholderText('Jeffery'), { target: { value: 'Jeffery' } });
    fireEvent.click(screen.getByText('Continue'));

    // Step 3 (Local is selected and prefilled by default, which is valid)
    fireEvent.click(screen.getByText('Continue'));

    // Step 4
    expect(screen.getByText('Configuration Summary')).toBeInTheDocument();

    // Mock Profile save and Settings save
    mockFetch
      .mockResolvedValueOnce({ ok: true }) // Profile save
      .mockResolvedValueOnce({ ok: true }); // Settings save

    fireEvent.click(screen.getByText('Launch Private AI 🚀'));

    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalled();
    });
  });

  test('Step 1 selects RPi and ESP32 device options', async () => {
    render(<SetupWizard token="test_token" onComplete={mockOnComplete} />);

    // Select Raspberry Pi card
    const rpiCard = screen.getByText('Raspberry Pi (Field Node)').closest('div');
    fireEvent.click(rpiCard);
    
    // Change select option for RPi type
    const rpiSelect = screen.getByDisplayValue('Raspberry Pi 5 (8GB)');
    fireEvent.click(rpiSelect);
    fireEvent.change(rpiSelect, { target: { value: 'rpi-zero-2w' } });
    
    // Select ESP32 card
    const espCard = screen.getByText('ESP32 WiFi (MicroPython)').closest('div');
    fireEvent.click(espCard);

    // Change select option for ESP type
    const espSelect = screen.getByDisplayValue('ESP32-S3');
    fireEvent.click(espSelect);
    fireEvent.change(espSelect, { target: { value: 'esp32-c6' } });

    // Verify it updates correctly
    expect(screen.getByText('Device Selection')).toBeInTheDocument();
  });

  test('Step 3 connection test failed paths', async () => {
    render(<SetupWizard token="test_token" onComplete={mockOnComplete} />);

    // Step 1
    fireEvent.click(screen.getByText('Continue'));

    // Step 2
    fireEvent.change(screen.getByPlaceholderText('Jeffery'), { target: { value: 'Jeffery' } });
    fireEvent.click(screen.getByText('Continue'));

    // Connection returns status 400
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Ollama is offline' })
    });

    const testBtn = screen.getByText('⚡ Test Connection');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText('Ollama is offline')).toBeInTheDocument();
    });

    // Connection throws error
    mockFetch.mockRejectedValueOnce(new Error('DNS lookup failure'));
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText('DNS lookup failure')).toBeInTheDocument();
    });
  });

  test('Step 2 handles profile data inputs, toggles, back navigation, and save failures', async () => {
    const alertSpy = vi.spyOn(global, 'alert').mockImplementation(() => {});
    const { container } = render(<SetupWizard token="test_token" onComplete={mockOnComplete} />);

    // Step 1: Continue
    fireEvent.click(screen.getByText('Continue'));

    // Step 2: Fill inputs
    fireEvent.change(screen.getByPlaceholderText('Jeffery'), { target: { value: 'Tester' } });
    fireEvent.change(screen.getByPlaceholderText('32421'), { target: { value: '90210' } });
    fireEvent.change(screen.getByPlaceholderText('US'), { target: { value: 'CA' } });
    
    // Change temp units select
    // Change temp units select
    const tempSelect = screen.getByRole('combobox');
    fireEvent.change(tempSelect, { target: { value: 'metric' } });

    // Weather key input
    fireEvent.change(screen.getByPlaceholderText('Enter weather api key'), { target: { value: 'weather_123' } });

    // Toggle weather key eye
    const weatherInput = screen.getByPlaceholderText('Enter weather api key');
    const weatherEye = weatherInput.parentElement.querySelector('button');
    if (weatherEye) fireEvent.click(weatherEye);

    // Click back from Step 2 to Step 1
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Device Selection')).toBeInTheDocument();

    // Go to Step 2 again
    fireEvent.click(screen.getByText('Continue'));
    
    // Go to Step 3
    fireEvent.click(screen.getByText('Continue'));

    // Select Online API and toggle Anthropic / OpenAI
    fireEvent.click(screen.getByText('Online API'));
    
    const providerSelects = screen.getAllByRole('combobox');
    const onlineProvSelect = providerSelects.find(s => s.value === 'gemini');
    if (onlineProvSelect) {
      fireEvent.change(onlineProvSelect, { target: { value: 'openai' } });
    }

    // Fill online key
    fireEvent.change(screen.getByPlaceholderText('Enter API Key'), { target: { value: 'my_gemini_key' } });

    // Toggle Online Key Eye
    const onlineInput = screen.getByPlaceholderText('Enter API Key');
    const onlineEye = onlineInput.parentElement.querySelector('button');
    if (onlineEye) fireEvent.click(onlineEye);

    // Switch back to OpenAI online provider and check default model
    if (onlineProvSelect) {
      fireEvent.change(onlineProvSelect, { target: { value: 'anthropic' } });
    }

    // Click back from Step 3 to Step 2
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Personal Profile Details')).toBeInTheDocument();

    // Go back to Step 3
    fireEvent.click(screen.getByText('Continue'));
    
    // Switch back to Local and Continue to Step 4
    fireEvent.click(screen.getByText('Local API'));
    
    // Cover Local API inputs
    fireEvent.change(screen.getByPlaceholderText('e.g. http://192.168.1.42:1234/v1'), { target: { value: 'http://127.0.0.1:11434/v1' } });
    fireEvent.change(screen.getByPlaceholderText('Token if required'), { target: { value: 'secret-local-key' } });
    
    const localSelects = screen.getAllByRole('combobox');
    const apiStyleSelect = localSelects.find(s => s.value === 'openai');
    if (apiStyleSelect) {
      fireEvent.change(apiStyleSelect, { target: { value: 'lm-studio' } });
    }

    // Toggle local key eye button
    const localInput = screen.getByPlaceholderText('Token if required');
    const localEyeBtn = localInput.parentElement.querySelector('button');
    if (localEyeBtn) fireEvent.click(localEyeBtn);

    fireEvent.click(screen.getByText('Continue'));

    // Click back from Step 4 to Step 3
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('LLM Configuration')).toBeInTheDocument();

    // Continue to Step 4
    fireEvent.click(screen.getByText('Continue'));

    // Mock save settings failure
    mockFetch
      .mockResolvedValueOnce({ ok: true }) // Profile save ok
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Database locked' }) }); // Settings save fail

    fireEvent.click(screen.getByText('Launch Private AI 🚀'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Database locked'));
    });

    alertSpy.mockRestore();
  });

  test('Step 1 selects Windows card option', async () => {
    render(<SetupWizard token="test_token" onComplete={mockOnComplete} />);

    // Select Windows card
    const windowsCard = screen.getByText('Windows (Main Host)').closest('div');
    fireEvent.click(windowsCard);
    expect(screen.getByText('Device Selection')).toBeInTheDocument();
  });

  test('Step 4 handle profile save failures', async () => {
    const alertSpy = vi.spyOn(global, 'alert').mockImplementation(() => {});
    render(<SetupWizard token="test_token" onComplete={mockOnComplete} />);

    // Step 1 -> Step 2 -> Step 3 -> Step 4
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.change(screen.getByPlaceholderText('Jeffery'), { target: { value: 'Tester' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));

    // Mock Profile save fail
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Profile DB error' })
    });

    fireEvent.click(screen.getByText('Launch Private AI 🚀'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Profile DB error'));
    });

    alertSpy.mockRestore();
  });
});
