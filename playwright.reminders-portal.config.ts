import { defineConfig } from '@playwright/test';
import base from './playwright.portal.config';
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4337' },
  webServer: {
    command: 'node scripts/portal-test-server.mjs',
    url: 'http://127.0.0.1:4337',
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      PORTAL_TEST_PORT: '4337',
      PORTAL_TEST_BUILD_DIR: '.build-candidates/reminders-portal/site',
    },
  },
});
