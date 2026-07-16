import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    coverage: {
      include: [
        'src/components/Sidebar.jsx',
        'src/components/Auth.jsx',
        'src/components/CalendarPane.jsx',
        'src/components/CustomAlertModal.jsx',
        'src/components/ExpandableThoughts.jsx',
        'src/components/MemoryPane.jsx',
        'src/components/PopoutWindow.jsx',
        'src/components/ProfileModal.jsx',
        'src/components/SetupWizard.jsx',
        'src/components/SudoModal.jsx',
        'src/components/Toast.jsx',
        'src/components/AgentDashboard.jsx'
      ],
      thresholds: {
        statements: 70,
        lines: 70
      }
    }
  }
});
