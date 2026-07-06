import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function PopoutWindow({ children, onClose }) {
  const containerEl = useRef(document.createElement('div'));
  const externalWindow = useRef(null);

  useEffect(() => {
    if (typeof window.open !== 'function') {
      console.warn('window.open is not supported in this environment');
      onClose(); // Auto close if window.open is not supported to avoid stuck state in tests
      return;
    }

    // Open child popout window
    externalWindow.current = window.open(
      '',
      'ChatPopout',
      'width=650,height=850,left=150,top=100,resizable=yes,scrollbars=yes'
    );

    if (externalWindow.current) {
      const doc = externalWindow.current.document;

      // Copy all stylesheets from parent document
      Array.from(document.styleSheets).forEach(styleSheet => {
        try {
          if (styleSheet.cssRules) {
            const newStyleEl = doc.createElement('style');
            Array.from(styleSheet.cssRules).forEach(cssRule => {
              newStyleEl.appendChild(doc.createTextNode(cssRule.cssText));
            });
            doc.head.appendChild(newStyleEl);
          } else if (styleSheet.href) {
            const newLinkEl = doc.createElement('link');
            newLinkEl.rel = 'stylesheet';
            newLinkEl.href = styleSheet.href;
            doc.head.appendChild(newLinkEl);
          }
        } catch (e) {
          // Fallback if stylesheet reading is restricted
        }
      });

      // Copy other links/style nodes
      Array.from(document.head.querySelectorAll('link, style')).forEach(el => {
        if (el.tagName === 'LINK' && el.rel === 'stylesheet' && !doc.head.querySelector(`link[href="${el.href}"]`)) {
          doc.head.appendChild(el.cloneNode(true));
        }
      });

      // Set page Title
      doc.title = 'Private AI Chat';

      // Set baseline themes and background styles
      doc.body.className = document.body.className;
      doc.body.style.cssText = document.body.style.cssText;
      doc.body.style.margin = '0';
      doc.body.style.padding = '0';
      doc.body.style.overflow = 'hidden';
      doc.body.style.backgroundColor = '#0b0f19'; // Deep rich dark mode background

      // Create container layout structure identical to React root
      const appWrapper = doc.createElement('div');
      appWrapper.style.cssText = 'display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden;';
      
      containerEl.current.style.cssText = 'display: flex; flex-direction: column; flex: 1; height: 100%; width: 100%; overflow: hidden;';
      appWrapper.appendChild(containerEl.current);
      doc.body.appendChild(appWrapper);

      const handleBeforeUnload = () => {
        onClose();
      };
      
      externalWindow.current.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        if (externalWindow.current) {
          externalWindow.current.removeEventListener('beforeunload', handleBeforeUnload);
          externalWindow.current.close();
          externalWindow.current = null;
        }
      };
    }
  }, [onClose]);

  return createPortal(children, containerEl.current);
}
