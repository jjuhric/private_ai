import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Global Fetch & EventSource Overrides for Standalone Spoke Dashboard
const hostUrl = localStorage.getItem('main_host_url') || '';

if (hostUrl) {
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      input = `${hostUrl}${input}`;
    }
    return originalFetch(input, init);
  };

  const OriginalEventSource = window.EventSource;
  window.EventSource = class extends OriginalEventSource {
    constructor(url, options) {
      let finalUrl = url;
      if (typeof url === 'string' && url.startsWith('/api/')) {
        finalUrl = `${hostUrl}${url}`;
      }
      super(finalUrl, options);
    }
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
