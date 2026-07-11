import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import CustomAlertModal from './CustomAlertModal';

describe('CustomAlertModal Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset pathname
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { pathname: '/' }
    });
  });

  test('returns null when alert prop is falsy', () => {
    const { container } = render(<CustomAlertModal alert={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders info alert with correct styling and badge', () => {
    const alertObj = { type: 'info', message: 'This is info' };
    const onClose = vi.fn();
    render(<CustomAlertModal alert={alertObj} onClose={onClose} />);

    expect(screen.getByText('This is info')).toBeInTheDocument();
    expect(screen.getAllByText('Info').length).toBeGreaterThan(0);
    expect(screen.getByText('Acknowledge')).toBeInTheDocument();
  });

  test('renders error alert with correct badge and closes', () => {
    const alertObj = { type: 'error', message: 'Something went wrong' };
    const onClose = vi.fn();
    render(<CustomAlertModal alert={alertObj} onClose={onClose} />);

    expect(screen.getAllByText('Error').length).toBeGreaterThan(0);
    
    // Click close button
    const closeBtn = screen.getByRole('button', { name: '' }); // Lucide X button doesn't have name
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('renders warning alert and fires hover styling events', () => {
    const alertObj = { type: 'warning', message: 'Be careful' };
    const onClose = vi.fn();
    const { container } = render(<CustomAlertModal alert={alertObj} onClose={onClose} />);

    expect(screen.getAllByText('Warning').length).toBeGreaterThan(0);
    
    // Mouse hover events on header close button
    const closeBtn = container.querySelector('header + div button') || screen.getAllByRole('button')[0];
    fireEvent.mouseEnter(closeBtn);
    fireEvent.mouseLeave(closeBtn);

    // Mouse hover events on acknowledge button
    const ackBtn = screen.getByRole('button', { name: 'Acknowledge' });
    fireEvent.mouseEnter(ackBtn);
    fireEvent.mouseLeave(ackBtn);
  });

  test('renders confirm alert and triggers confirmation callback', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const alertObj = { type: 'confirm', message: 'Are you sure?', onConfirm };
    
    render(<CustomAlertModal alert={alertObj} onClose={onClose} />);
    expect(screen.getAllByText('Confirm').length).toBeGreaterThan(0);

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' });

    // Test mouse hovers
    fireEvent.mouseEnter(cancelBtn);
    fireEvent.mouseLeave(cancelBtn);
    fireEvent.mouseEnter(confirmBtn);
    fireEvent.mouseLeave(confirmBtn);

    // Click confirm
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('detects monitor path correctly for image URLs', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { pathname: '/monitor/dashboard' }
    });

    const alertObj = { type: 'info', message: 'Monitor Alert' };
    render(<CustomAlertModal alert={alertObj} onClose={vi.fn()} />);

    const images = screen.getAllByRole('img');
    expect(images[0].src).toContain('/monitor/favicon.png');
    expect(images[1].src).toContain('/monitor/patti_text.png');
  });
});
