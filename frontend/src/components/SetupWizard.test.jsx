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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Local connection successful' })
    });

    const testBtn = screen.getByText('⚡ Test Connection');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText('Local connection successful')).toBeInTheDocument();
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
});
