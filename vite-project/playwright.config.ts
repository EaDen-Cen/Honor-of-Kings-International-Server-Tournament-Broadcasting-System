import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:3101', viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' } },
  webServer: { command: 'npm run server', url: 'http://127.0.0.1:3101/api/health', reuseExistingServer: false,
    env: { PORT: '3101', HOST: '127.0.0.1', NODE_ENV: 'development', DATA_FILE: `artifacts/e2e-${Date.now()}/match.json`, CONTROL_TOKEN: 'e2e-control', CASTER_TOKEN: 'e2e-caster', OVERLAY_TOKEN: 'e2e-overlay' } },
});
