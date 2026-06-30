import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CalendarPane from './CalendarPane';

describe('CalendarPane Component Tests', () => {
  const defaultProps = {
    calendarEvents: [
      { id: 1, title: 'Sync Meeting', start_time: '2026-06-30 10:00', end_time: '2026-06-30 11:00', description: 'Review progress' },
      { id: 2, title: 'Lunch', start_time: '2026-06-30 12:00', end_time: '2026-06-30 13:00' } // No description to cover the false branch
    ],
    calendarForm: { title: '', start_time: '', end_time: '', description: '' },
    setCalendarForm: vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater({ title: '', start_time: '', end_time: '', description: '' });
      }
    }),
    calendarDate: '2026-06-30',
    setCalendarDate: vi.fn(),
    handleAddCalendarEvent: vi.fn(),
    handleDeleteCalendarEvent: vi.fn()
  };

  test('renders events and handles date changes', () => {
    render(<CalendarPane {...defaultProps} />);
    expect(screen.getByText('Schedule for 2026-06-30')).toBeInTheDocument();
    expect(screen.getByText('Sync Meeting')).toBeInTheDocument();
    expect(screen.getByText('Review progress')).toBeInTheDocument();
    expect(screen.getByText('Lunch')).toBeInTheDocument();

    const dateInput = screen.getAllByRole('textbox').find(inp => inp.type === 'date') || screen.getByDisplayValue('2026-06-30');
    fireEvent.change(dateInput, { target: { value: '2026-07-01' } });
    expect(defaultProps.setCalendarDate).toHaveBeenCalledWith('2026-07-01');
  });

  test('renders empty scheduled state description banner', () => {
    render(<CalendarPane {...defaultProps} calendarEvents={[]} />);
    expect(screen.getByText('No meetings or tasks scheduled for this day.')).toBeInTheDocument();
  });

  test('handles event deletion', () => {
    render(<CalendarPane {...defaultProps} />);
    const delBtns = screen.getAllByRole('button');
    // First button is calendar delete event button
    fireEvent.click(delBtns[0]);
    expect(defaultProps.handleDeleteCalendarEvent).toHaveBeenCalledWith(1);
  });

  test('submits new appointment form with all fields', () => {
    const mockSetCalendarForm = vi.fn().mockImplementation((updater) => {
      if (typeof updater === 'function') {
        updater({ title: '', start_time: '', end_time: '', description: '' });
      }
    });
    const mockHandleAddCalendarEvent = vi.fn();

    const { container } = render(
      <CalendarPane 
        {...defaultProps} 
        setCalendarForm={mockSetCalendarForm}
        handleAddCalendarEvent={mockHandleAddCalendarEvent}
      />
    );

    const titleInput = screen.getByPlaceholderText('e.g. Code Review');
    fireEvent.change(titleInput, { target: { value: 'Standup' } });
    
    const startInput = screen.getAllByPlaceholderText('YYYY-MM-DD HH:MM')[0];
    fireEvent.change(startInput, { target: { value: '2026-06-30 09:00' } });

    const endInput = screen.getAllByPlaceholderText('YYYY-MM-DD HH:MM')[1];
    fireEvent.change(endInput, { target: { value: '2026-06-30 09:30' } });

    const descInput = screen.getByPlaceholderText('Notes...');
    fireEvent.change(descInput, { target: { value: 'Daily standup meeting notes' } });

    expect(mockSetCalendarForm).toHaveBeenCalled();

    const form = container.querySelector('form');
    fireEvent.submit(form);
    expect(mockHandleAddCalendarEvent).toHaveBeenCalled();
  });
});
