import { defineConfig, devices } from '@playwright/test';

// Start scripts/preview-exhibition-map.mjs first. Tests use public profiles and
// browser-local saves only; they never access or submit participant forms.
export default defineConfig({
  testDir: './tests/atlas-browser',
  outputDir: './.portal-test/atlas-browser-results',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.CREATECH_ATLAS_ORIGIN ?? 'http://127.0.0.1:4330',
    launchOptions: {
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'atlas-desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'atlas-mobile',
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } },
    },
  ],
});
