import React from 'react';
import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExpandableThoughts from './ExpandableThoughts';

describe('ExpandableThoughts Component Tests', () => {
  test('returns null if thoughts are empty or contain only tags', () => {
    const { container } = render(<ExpandableThoughts thoughts="<think></think>" />);
    expect(container.firstChild).toBeNull();
  });

  test('returns null if thoughts prop is missing or falsy', () => {
    const { container } = render(<ExpandableThoughts thoughts={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders thoughts and collapses/expands correctly', () => {
    render(<ExpandableThoughts thoughts="<think>Deep plan details</think>" />);
    expect(screen.getByText(/Agent Plan & Internal Thoughts/)).toBeInTheDocument();
    
    // Collapsed by default
    expect(screen.queryByText('Deep plan details')).toBeNull();

    // Click header to expand
    const header = screen.getByText(/Agent Plan & Internal Thoughts/);
    fireEvent.click(header);
    expect(screen.getByText('Deep plan details')).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(header);
    expect(screen.queryByText('Deep plan details')).toBeNull();
  });

  test('respects defaultExpanded prop and reacts to updates', () => {
    const { rerender } = render(<ExpandableThoughts thoughts="Thinking content" defaultExpanded={true} />);
    expect(screen.getByText('Thinking content')).toBeInTheDocument();

    rerender(<ExpandableThoughts thoughts="Thinking content" defaultExpanded={false} />);
    expect(screen.queryByText('Thinking content')).toBeNull();
  });
});
