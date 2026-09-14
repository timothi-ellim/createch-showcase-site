import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/portal-browser',
  workers: 1,
  fullyParallel: false,
  outputDir: '.portal-test/results',
  reporter: [
    ['list'],
    ['html', { outputFolder: '.portal-test/report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4325',
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/portal-test-server.mjs',
    url: 'http://127.0.0.1:4325',
    timeout: 120000,
    reuseExistingServer: false,
  },
});
