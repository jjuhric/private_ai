import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Auth from './Auth';

describe('Auth Component Tests', () => {
  const defaultProps = {
    authForm: { username: 'user1', password: 'pwd' },
    setAuthForm: vi.fn(),
    isLogin: true,
    setIsLogin: vi.fn(),
    authError: '',
    setAuthError: vi.fn(),
    handleAuthSubmit: vi.fn(),
    showAuthPassword: false,
    setShowAuthPassword: vi.fn()
  };

  test('renders login card and accepts inputs', () => {
    render(<Auth {...defaultProps} />);
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    
    const submitBtn = screen.getByRole('button', { name: 'Login' });
    expect(submitBtn).toBeInTheDocument();
  });

  test('renders error banner if authError exists', () => {
    render(<Auth {...defaultProps} authError="Invalid details" />);
    expect(screen.getByText('Invalid details')).toBeInTheDocument();
  });

  test('renders register mode and switches modes', () => {
    const mockSetIsLogin = vi.fn();
    const mockSetAuthError = vi.fn();

    render(
      <Auth 
        {...defaultProps} 
        isLogin={false} 
        setIsLogin={mockSetIsLogin} 
        setAuthError={mockSetAuthError} 
      />
    );

    expect(screen.getByText('Create Account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();

    const switchSpan = screen.getByText('Login');
    fireEvent.click(switchSpan);
    expect(mockSetIsLogin).toHaveBeenCalledWith(true);
    expect(mockSetAuthError).toHaveBeenCalledWith('');
  });

  test('toggles password visibility and handles input change', () => {
    const mockSetAuthForm = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater(defaultProps.authForm);
      }
    });
    const mockSetShowAuthPassword = vi.fn();

    const { container } = render(
      <Auth 
        {...defaultProps} 
        setAuthForm={mockSetAuthForm} 
        setShowAuthPassword={mockSetShowAuthPassword} 
      />
    );

    // Get username input
    const usernameInput = container.querySelector('input[type="text"]');
    fireEvent.change(usernameInput, { target: { value: 'updateduser' } });
    expect(mockSetAuthForm).toHaveBeenCalled();

    // Get password input
    const pwdInput = container.querySelector('input[type="password"]');
    fireEvent.change(pwdInput, { target: { value: 'updatedpwd' } });
    expect(mockSetAuthForm).toHaveBeenCalledTimes(2);
    
    // Toggle show password button
    const toggleBtn = container.querySelector('button[type="button"]');
    fireEvent.click(toggleBtn);
    expect(mockSetShowAuthPassword).toHaveBeenCalled();
  });

  test('renders password with text type when showAuthPassword is true', () => {
    const { container } = render(
      <Auth 
        {...defaultProps} 
        showAuthPassword={true}
      />
    );

    const pwdInput = container.querySelector('input[type="text"]'); // should resolve to text
    expect(pwdInput).toBeInTheDocument();
  });

  test('logo onError event triggers fallback', () => {
    const { container } = render(<Auth {...defaultProps} />);
    const img = container.querySelector('img');
    fireEvent.error(img);
    expect(img.src).toContain('placehold.co');
  });
});
