import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/reminders-browser',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4339',
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    },
    screenshot: 'only-on-failure',
  },
});
