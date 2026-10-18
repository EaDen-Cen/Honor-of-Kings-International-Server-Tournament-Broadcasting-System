import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const windowsChrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath=process.env.CHROME_PATH || (process.platform==='win32'&&existsSync(windowsChrome)?windowsChrome:undefined);

export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 90000,
  forbidOnly: !!process.env.CI,
  use: { baseURL: 'http://127.0.0.1:3101', viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath } },
});
