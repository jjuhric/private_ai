import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Toast from './Toast';

describe('Toast Component Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns null if message is empty or missing', () => {
    const { container } = render(<Toast message="" onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders toast with correct message and type class', () => {
    render(<Toast message="Operation successful" type="success" onClose={() => {}} />);
    expect(screen.getByText('Operation successful')).toBeInTheDocument();
    
    const notification = screen.getByText('Operation successful').closest('.toast-notification');
    expect(notification).toHaveClass('success');
  });

  test('calls onClose after duration', () => {
    const onClose = vi.fn();
    render(<Toast message="Informational message" type="info" duration={3000} onClose={onClose} />);
    
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<Toast message="Error occurred" type="error" onClose={onClose} />);
    
    const closeBtn = screen.getByRole('button', { name: /dismiss notification/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
