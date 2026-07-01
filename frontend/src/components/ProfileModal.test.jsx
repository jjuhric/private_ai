import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileModal from './ProfileModal';

describe('ProfileModal Component Tests', () => {
  const defaultProfile = {
    name: 'Jeffery Uhrick',
    zipcode: '32421',
    country: 'US',
    temp_unit: 'imperial',
    weather_api_key: 'test_key_123'
  };

  test('does not render when isProfileOpen is false', () => {
    const { container } = render(
      <ProfileModal 
        isProfileOpen={false} 
        setIsProfileOpen={vi.fn()} 
        profile={defaultProfile} 
        saveProfile={vi.fn()} 
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders form elements and populates default data when open', () => {
    render(
      <ProfileModal 
        isProfileOpen={true} 
        setIsProfileOpen={vi.fn()} 
        profile={defaultProfile} 
        saveProfile={vi.fn()} 
      />
    );

    expect(screen.getByText('User Profile Settings')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your preferred name').value).toBe('Jeffery Uhrick');
    expect(screen.getByPlaceholderText('e.g. 32421').value).toBe('32421');
    expect(screen.getByPlaceholderText('US').value).toBe('US');
    expect(screen.getByDisplayValue('Imperial (°F, mph)')).toBeInTheDocument();
  });

  test('submits updated form values successfully', () => {
    const mockSaveProfile = vi.fn();
    const mockSetIsProfileOpen = vi.fn();

    const { container } = render(
      <ProfileModal 
        isProfileOpen={true} 
        setIsProfileOpen={mockSetIsProfileOpen} 
        profile={defaultProfile} 
        saveProfile={mockSaveProfile} 
      />
    );

    // Update inputs
    const nameInput = screen.getByPlaceholderText('Your preferred name');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });

    const zipInput = screen.getByPlaceholderText('e.g. 32421');
    fireEvent.change(zipInput, { target: { value: '90210' } });

    const countryInput = screen.getByPlaceholderText('US');
    fireEvent.change(countryInput, { target: { value: 'gb' } });

    const tempSelect = screen.getByRole('combobox');
    fireEvent.change(tempSelect, { target: { value: 'metric' } });

    // Show/hide API key toggle
    const toggleBtn = container.querySelector('button[type="button"]');
    fireEvent.click(toggleBtn);

    const apiKeyInput = screen.getByPlaceholderText('Enter OpenWeatherMap API key');
    fireEvent.change(apiKeyInput, { target: { value: 'new_key' } });

    // Submit form
    const saveButton = screen.getByText('Save Profile');
    fireEvent.click(saveButton);

    expect(mockSaveProfile).toHaveBeenCalledWith({
      name: 'New Name',
      zipcode: '90210',
      country: 'GB',
      temp_unit: 'metric',
      weather_api_key: 'new_key'
    });
  });

  test('modal close triggers', () => {
    const mockSetIsProfileOpen = vi.fn();
    const { container } = render(
      <ProfileModal 
        isProfileOpen={true} 
        setIsProfileOpen={mockSetIsProfileOpen} 
        profile={defaultProfile} 
        saveProfile={vi.fn()} 
      />
    );

    // Click overlay
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.click(overlay);
    expect(mockSetIsProfileOpen).toHaveBeenCalledWith(false);

    // Click header close button
    const closeBtn = container.querySelector('.modal-header button');
    fireEvent.click(closeBtn);
    expect(mockSetIsProfileOpen).toHaveBeenCalledTimes(2);
  });

  test('handles missing profile or empty properties in profile', () => {
    const { rerender } = render(
      <ProfileModal 
        isProfileOpen={true} 
        setIsProfileOpen={vi.fn()} 
        profile={null} 
        saveProfile={vi.fn()} 
      />
    );
    expect(screen.getByPlaceholderText('Your preferred name').value).toBe('');

    rerender(
      <ProfileModal 
        isProfileOpen={true} 
        setIsProfileOpen={vi.fn()} 
        profile={{ name: 'No Country' }} 
        saveProfile={vi.fn()} 
      />
    );
    expect(screen.getByPlaceholderText('US').value).toBe('US');
  });
});
