import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
const event = JSON.parse(readFileSync('content/event.json', 'utf8'));

test('full event copy and email sharing work without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 800 },
  });
  const page = await context.newPage();
  for (const path of ['/', '/about/']) {
    await page.goto(`http://127.0.0.1:4321${path}`);
    for (const paragraph of event.description.split('\n\n'))
      await expect(page.getByText(paragraph, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.goto('http://127.0.0.1:4321/?utm_source=private-test');
  const email = await page
    .getByRole('link', { name: 'Share by email' })
    .getAttribute('href');
  expect(decodeURIComponent(email!)).toContain(event.dateLabel);
  expect(decodeURIComponent(email!)).not.toContain('utm_source');
  await page.getByText('Get the event link', { exact: true }).click();
  await expect(page.getByLabel('Copy this address to share')).toHaveValue(
    /^http:\/\/(localhost|127\.0\.0\.1):4321\/$/,
  );
  await expect(
    page.getByRole('button', { name: 'Copy link', exact: true }),
  ).toBeHidden();
  await context.close();
});

test('copy sharing reports clipboard success and falls back honestly on failure', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).copied = value;
        },
      },
    });
  });
  await page.goto('/?utm_source=private-test#event-description-heading');
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  expect(await page.evaluate(() => (window as any).copied)).toBe(
    'http://127.0.0.1:4321/',
  );
  await expect(page.locator('[data-share-feedback]')).toContainText(
    'Local preview link copied',
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.getByLabel('Copy this address to share')).toBeFocused();
  await expect(page.locator('[data-share-feedback]')).toContainText(
    'Automatic sharing is unavailable',
  );
});

test('native share cancellation is quiet; errors reveal the selected link', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Share link…', exact: true }).click();
  await expect(page.locator('[data-share-feedback]')).toBeEmpty();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      value: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    });
  });
  await page.getByRole('button', { name: 'Share link…', exact: true }).click();
  await expect(page.getByLabel('Copy this address to share')).toBeFocused();
});

test('event and project sharing metadata, keyboard controls and narrow reading layouts', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const projectUrl = await page
    .locator('a[href^="/projects/"]')
    .first()
    .getAttribute('href');
  for (const path of ['/', '/about/', projectUrl!]) {
    await page.goto(path);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        path,
      ).toBeTruthy();
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expect(
      page.locator('meta[property="og:image:width"]'),
    ).toHaveAttribute('content', '1200');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
    if (path.startsWith('/projects/')) {
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        'content',
        `/social/projects/${path.split('/')[2]}.png`,
      );
      const summary = page.locator('[data-share-fallback] summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Copy this address to share')).toBeVisible();
    }
  }
});
