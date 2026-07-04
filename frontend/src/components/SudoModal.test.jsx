import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SudoModal from './SudoModal';

describe('SudoModal Component Tests', () => {
  test('does not render when isOpen is false', () => {
    const { container } = render(
      <SudoModal 
        isOpen={false} 
        onClose={vi.fn()} 
        onSubmit={vi.fn()} 
        command="sudo systemctl restart private-ai" 
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders form elements when open', () => {
    render(
      <SudoModal 
        isOpen={true} 
        onClose={vi.fn()} 
        onSubmit={vi.fn()} 
        command="sudo systemctl restart private-ai" 
      />
    );

    expect(screen.getByText('Elevated Privileges Required')).toBeInTheDocument();
    expect(screen.getByText('sudo systemctl restart private-ai')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
  });

  test('submits password correctly', () => {
    const mockOnSubmit = vi.fn();
    render(
      <SudoModal 
        isOpen={true} 
        onClose={vi.fn()} 
        onSubmit={mockOnSubmit} 
        command="sudo systemctl restart private-ai" 
      />
    );

    const input = screen.getByPlaceholderText('Enter password');
    fireEvent.change(input, { target: { value: 'mypassword123' } });

    const submitBtn = screen.getByText('Submit');
    fireEvent.click(submitBtn);

    expect(mockOnSubmit).toHaveBeenCalledWith('mypassword123');
  });
});
