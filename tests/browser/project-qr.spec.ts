import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

test('QR dialog has canonical downloads, clipboard fallback and Escape focus restoration', async ({
  page,
}, info) => {
  await page.goto('/projects/sample-image-study/?theme=image');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
      configurable: true,
    }),
  );
  const trigger = page.getByRole('link', { name: 'QR code', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Close QR code' }),
  ).toBeFocused();
  await expect(dialog.locator('.qr-address')).toHaveAttribute(
    'href',
    'https://createch-preview.invalid/projects/sample-image-study/',
  );
  await expect(
    dialog.getByRole('link', { name: 'Download PNG' }),
  ).toHaveAttribute('href', '/generated/qr/sample-image-study.png');
  await expect
    .poll(() =>
      dialog
        .locator('img')
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(
    'Copy was unavailable',
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir('docs/evidence/presence-qr', { recursive: true });
  await page.screenshot({
    path: `docs/evidence/presence-qr/project-qr-${info.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('project QR and practical information remain readable without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 740 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/projects/sample-long-title/`);
    const trigger = page.getByRole('link', { name: 'QR code', exact: true });
    await expect(trigger).toHaveAttribute(
      'href',
      '/generated/qr/sample-long-title.svg',
    );
    const href = await trigger.getAttribute('href');
    const res = await context.request.get(baseURL + href!);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain('<svg');
    const aside = page.locator('.detail aside'),
      narrative = page.locator('.detail-reading');
    expect((await aside.boundingBox())!.y).toBeLessThan(
      (await narrative.boundingBox())!.y,
    );
    await expect(
      page.getByRole('heading', { name: 'Meet the artist', exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
