import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/participant-auth-browser',
  workers: 1,
  outputDir: '.portal-test/auth-results',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4326',
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
    },
  },
  webServer: {
    command: 'node scripts/portal-test-server.mjs',
    url: 'http://127.0.0.1:4326',
    timeout: 120000,
    env: {
      PUBLIC_PARTICIPANT_AUTH_V2: 'true',
      PORTAL_TEST_PORT: '4326',
      PORTAL_TEST_BUILD_DIR: '.build-candidates/participant-auth-browser/site',
    },
  },
});
