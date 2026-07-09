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
  window.EventSource = function(url, options) {
    if (url.startsWith('/api/')) {
      url = `${hostUrl}${url}`;
    }
    return new OriginalEventSource(url, options);
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
