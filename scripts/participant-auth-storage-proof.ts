// Real local browser/API check of the storage-denied session fallback.
import { chromium, expect } from '@playwright/test';
import {
  localRuntime,
  fixtureJournal,
  checked,
} from './portal-local-runtime.ts';
import { writeFile } from 'node:fs/promises';
const r = localRuntime(),
  j = await fixtureJournal();
const who = j.users[0];
if (!/^portal-integration-.*@example\.invalid$/.test(who.email))
  throw Error('SYNTHETIC_ONLY');
const link = await checked(
  r.admin.auth.admin.generateLink({ type: 'magiclink', email: who.email }),
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() =>
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    }),
  );
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4321/participant/login/');
  await page.getByLabel('Email address', { exact: true }).fill(who.email);
  await page
    .getByRole('button', { name: 'I already have a code', exact: true })
    .click();
  await page
    .getByLabel('Email code', { exact: true })
    .fill(link.properties.email_otp);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Project title', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(
    'http://127.0.0.1:4321/participant/editor/?project=' + j.projects[0],
  );
  await page
    .getByLabel('Project title', { exact: true })
    .fill('Synthetic storage-denied save');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('[data-editor-status]')).toContainText(
    'Draft saved.',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('[data-private-content]')).toBeEmpty();
  await writeFile(
    'docs/evidence/participant-auth/storage-denied.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        passed: true,
        scope:
          'Real local Auth/Edge/DB/browser; sessionStorage throws; synthetic account signs in, opens editor without reload, saves, signs out',
      },
      null,
      2,
    ),
  );
  console.log(
    'Storage-denied real browser sign-in, automatic project opening, save and logout passed.',
  );
} finally {
  await browser.close();
}
