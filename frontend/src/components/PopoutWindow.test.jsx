import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import PopoutWindow from './PopoutWindow';

describe('PopoutWindow Component Tests', () => {
  let mockWindowOpen;
  let mockWindowClose;
  let mockAddEventListener;
  let mockRemoveEventListener;
  let mockDocument;

  beforeEach(() => {
    mockWindowClose = vi.fn();
    mockAddEventListener = vi.fn();
    mockRemoveEventListener = vi.fn();
    
    mockDocument = {
      createElement: vi.fn().mockImplementation((tag) => {
        return {
          style: {},
          appendChild: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
      }),
      head: {
        appendChild: vi.fn(),
        querySelectorAll: vi.fn().mockReturnValue([]),
      },
      body: {
        appendChild: vi.fn(),
        style: {},
      },
      title: '',
    };

    mockWindowOpen = vi.fn().mockReturnValue({
      document: mockDocument,
      close: mockWindowClose,
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
    });

    vi.stubGlobal('open', mockWindowOpen);
    
    // Safely stub styleSheets on existing document using defineProperty
    Object.defineProperty(globalThis.document, 'styleSheets', {
      value: [
        {
          cssRules: [{ cssText: 'body { background: red; }' }]
        },
        {
          href: 'styles.css'
        }
      ],
      configurable: true
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.document.styleSheets;
  });

  test('renders children in a portal within the child window', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <PopoutWindow onClose={onClose}>
        <div data-testid="popout-content">Hello Popout</div>
      </PopoutWindow>
    );

    expect(mockWindowOpen).toHaveBeenCalled();
    expect(mockAddEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    // Verify cleanup
    unmount();
    expect(mockWindowClose).toHaveBeenCalled();
  });

  test('calls onClose if window.open is not a function', () => {
    vi.stubGlobal('open', undefined);
    const onClose = vi.fn();
    render(
      <PopoutWindow onClose={onClose}>
        <div>Hello Popout</div>
      </PopoutWindow>
    );
    expect(onClose).toHaveBeenCalled();
  });
});
