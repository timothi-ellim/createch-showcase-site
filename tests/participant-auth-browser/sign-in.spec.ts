import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
test('single-code journey has one email screen, accessible code entry, cooldown and error recovery', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1500 });
  const requests: any[] = [];
  await page.route('**/functions/v1/participant-auth-request', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'check_email', retryAfterSeconds: 60 }),
    });
  });
  await page.route('**/functions/v1/participant-auth-verify', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'CODE_NOT_VERIFIED' }),
    }),
  );
  await page.goto('/participant/login/');
  await expect(
    page.getByRole('button', { name: 'Email me a code', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page
    .getByLabel('Email address', { exact: true })
    .fill('synthetic@example.invalid');
  await mkdir('docs/evidence/participant-auth', { recursive: true });
  await page
    .locator('[data-login]')
    .screenshot({ path: 'docs/evidence/participant-auth/guide-email.png' });
  await page
    .getByRole('button', { name: 'Email me a code', exact: true })
    .click();
  await expect(page.getByLabel('Email code', { exact: true })).toBeFocused();
  expect(requests[0].mode).toBe('send');
  expect(requests[0].attemptKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText(/expires 24 hours/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Send a new code in/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Continue', exact: true }),
  ).toBeEnabled();
  await page
    .locator('[data-login]')
    .screenshot({ path: 'docs/evidence/participant-auth/guide-code.png' });
  await page.getByLabel('Email code', { exact: true }).fill('001 234');
  await expect(page.getByLabel('Email code', { exact: true })).toHaveValue(
    '001234',
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('could not be verified');
  await page.getByRole('button', { name: 'Change email', exact: true }).click();
  await page
    .getByRole('button', { name: 'I already have a code', exact: true })
    .click();
  expect(requests[1].mode).toBe('existing-code');
  expect(requests[1].attemptKey).not.toBe(requests[0].attemptKey);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await mkdir('docs/evidence/participant-auth', { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/evidence/participant-auth/code-${width}.png`,
      fullPage: true,
    });
  }
});
test('unavailable service restores controls and retry keeps the same send key', async ({
  page,
}) => {
  const attempts: string[] = [];
  await page.route('**/functions/v1/participant-auth-request', (route) => {
    attempts.push(route.request().postDataJSON().attemptKey);
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"code":"SIGN_IN_UNAVAILABLE"}',
    });
  });
  await page.goto('/participant/login/');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('synthetic@example.invalid');
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole('button', { name: 'Email me a code', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'temporarily unavailable',
    );
    await expect(
      page.getByRole('button', { name: 'Email me a code', exact: true }),
    ).toBeEnabled();
  }
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(attempts[1]);
});
test('no JavaScript retains help without claiming the editor works', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4326/participant/login/');
  await expect(page.getByText(/editor needs JavaScript/)).toBeVisible();
  await context.close();
});

test('uncertain replacement retries keep one key; provider retry interval is honoured', async ({
  page,
}) => {
  const calls: any[] = [];
  await page.route('**/functions/v1/participant-auth-request', (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    return route.fulfill({
      status: body.mode === 'existing-code' ? 202 : 503,
      contentType: 'application/json',
      body:
        body.mode === 'existing-code'
          ? '{"status":"check_email","retryAfterSeconds":60}'
          : '{"code":"SIGN_IN_UNAVAILABLE"}',
    });
  });
  await page.goto('/participant/login/');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('synthetic@example.invalid');
  await page
    .getByRole('button', { name: 'I already have a code', exact: true })
    .click();
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole('button', { name: 'Send a new code', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'temporarily unavailable',
    );
    await expect(
      page.getByRole('button', { name: 'Send a new code', exact: true }),
    ).toBeEnabled();
  }
  expect(calls[1].attemptKey).toBe(calls[2].attemptKey);
  expect(calls[1].attemptKey).not.toBe(calls[0].attemptKey);
  await page.route('**/functions/v1/participant-auth-request', (route) =>
    route.fulfill({
      status: 429,
      headers: {
        'Retry-After': '300',
        'Access-Control-Expose-Headers': 'Retry-After',
      },
      contentType: 'application/json',
      body: '{"code":"TRY_LATER"}',
    }),
  );
  await page
    .getByRole('button', { name: 'Send a new code', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /Send a new code in (300|299)s/ }),
  ).toBeDisabled();
});
