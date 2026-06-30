import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 10000,
    env: {
      PORT: '5173',
      DB_PATH: 'backend/test_database.db' // Use a separate DB for E2E testing
    }
  },
});
