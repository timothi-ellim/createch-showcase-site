import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
const evidence = 'docs/evidence/reminders';
test('signup, deliberate confirmation, organiser count and unsubscribe use the local database', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/__stats')).json();
  const email = `browser-${Date.now()}@example.invalid`;
  await page.goto('/reminders/');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send my confirmation link' }).click();
  await expect(
    page.getByRole('heading', { name: 'One small step. Check your inbox.' }),
  ).toBeVisible();
  await expect(page.locator('[data-reminder-received]')).toBeFocused();
  const mails = await (await request.get('/__mail.json')).json();
  const mail = mails.find((m: any) => m.to === email);
  expect(mail).toBeTruthy();
  const token = mail.text.match(/confirm\?token=([a-f0-9]+)/)[1];
  await page.goto(`/api/reminders/confirm?token=${token}`);
  expect((await (await request.get('/__stats')).json()).active).toBe(
    before.active,
  );
  await page.getByRole('button', { name: 'Confirm my reminders' }).click();
  await expect(
    page.getByRole('heading', { name: 'You’re on the reminder list.' }),
  ).toBeVisible();
  expect((await (await request.get('/__stats')).json()).active).toBe(
    before.active + 1,
  );
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: `${evidence}/confirmed-390.png`,
    fullPage: true,
  });
  const unsub = mail.text.match(/unsubscribe\?token=([a-f0-9]+)/)[1];
  await page.goto(`/api/reminders/unsubscribe?token=${unsub}`);
  await page.getByRole('button', { name: 'Stop my reminders' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your reminders have stopped.' }),
  ).toBeVisible();
  expect((await (await request.get('/__stats')).json()).active).toBe(
    before.active,
  );
});
test('mobile and desktop layouts, calendar disclosure, keyboard, axe and no unexpected errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/reminders/');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator('.reminder-sidebar .calendar-picker summary').click();
    const google = page.getByRole('link', { name: 'Google Calendar' }).last();
    await expect(google).toBeVisible();
    expect(await google.getAttribute('href')).toContain('20261028T110000Z');
    const a11y = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(a11y.violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await mkdir(evidence, { recursive: true });
    await page.screenshot({
      path: `${evidence}/signup-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByLabel('Email address', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox')).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Send my confirmation link' }),
  ).toBeFocused();
  await page.goto('/');
  await expect(page.locator('[data-event-countdown]')).toBeVisible();
  await page
    .locator('[data-event-actions]')
    .screenshot({ path: `${evidence}/event-panel-1440.png` });
  expect(errors).toEqual([]);
});
test('failed request retains email, shows an actionable error and never claims success', async ({
  page,
}) => {
  await page.goto('/reminders/');
  await page.route('**/api/reminders/subscribe', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'error',
        message:
          'Email reminders are temporarily unavailable. Please try again later.',
      }),
    }),
  );
  await page
    .getByLabel('Email address', { exact: true })
    .fill('failure@example.invalid');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send my confirmation link' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'temporarily unavailable',
  );
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(
    'failure@example.invalid',
  );
  await expect(page.locator('[data-reminder-received]')).toBeHidden();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: `${evidence}/signup-error-390.png`,
    fullPage: true,
  });
});
test('without JavaScript signup and calendar downloads work; no stale countdown appears', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4339/');
  await expect(page.locator('[data-event-countdown]')).toBeHidden();
  await expect(
    page.getByRole('link', { name: 'Get email reminders' }),
  ).toBeVisible();
  await page.goto('http://127.0.0.1:4339/reminders/');
  await page
    .getByLabel('Email address', { exact: true })
    .fill(`nojs-${Date.now()}@example.invalid`);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send my confirmation link' }).click();
  await expect(
    page.getByRole('heading', { name: 'One small step. Check your inbox.' }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Add to calendar (.ics)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.ics');
  await context.close();
});
test('countdown transitions, reduced motion and denied storage preserve event actions', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
  });
  await page.clock.install({ time: new Date('2026-10-28T10:59:30Z') });
  await page.goto('/visit/');
  await expect(page.locator('[data-count-minutes]')).toHaveText('01');
  await page.clock.fastForward(60000);
  await expect(page.locator('[data-countdown-caption]')).toHaveText(
    'The showcase is scheduled today.',
  );
  await page.clock.setSystemTime(new Date('2026-10-28T16:00:01Z'));
  await page.clock.fastForward(60000);
  await expect(page.locator('[data-countdown-caption]')).toContainText(
    'has ended',
  );
  await expect(page.locator('[data-reminder-link]')).toHaveAttribute(
    'href',
    '/explore/',
  );
});

test('overseas time zone and forced colours keep the UK event and keyboard calendar usable', async ({
  browser,
}) => {
  const context = await browser.newContext({
    timezoneId: 'America/New_York',
    forcedColors: 'active',
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-28T10:00:00Z') });
  await page.goto('http://127.0.0.1:4339/visit/');
  await expect(page.locator('[data-count-hours]')).toHaveText('01');
  const summary = page.locator('[data-event-actions] .calendar-picker summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const google = page
    .locator('[data-event-actions]')
    .getByRole('link', { name: 'Google Calendar' });
  await expect(google).toBeFocused();
  await expect(google).toHaveAttribute('href', /20261028T110000Z/);
  await page.keyboard.press('Shift+Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Space');
  await expect(google).toBeHidden();
  await context.close();
});
