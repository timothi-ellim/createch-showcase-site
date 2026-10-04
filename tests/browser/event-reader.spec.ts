import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const event = JSON.parse(readFileSync('content/event.json', 'utf8'));
const expected = event.description.split(/\n\s*\n/).filter(Boolean);

test('reader preserves every word and supports larger text and keyboard chapter links', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const route of ['/', '/about/']) {
    await page.goto(route);
    const paragraphs = page.locator('[data-event-paragraph]');
    expect(
      (await paragraphs.allTextContents()).map((text) =>
        text.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(expected.map((text: string) => text.replace(/\s+/g, ' ').trim()));
    const initialSize = await paragraphs
      .last()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    const size = page.getByRole('button', { name: 'Larger text' });
    await size.focus();
    await page.keyboard.press('Space');
    await expect(size).toHaveAttribute('aria-pressed', 'true');
    expect(
      await paragraphs
        .last()
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThan(initialSize);
    expect(
      (await paragraphs.allTextContents()).map((text) =>
        text.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(expected.map((text: string) => text.replace(/\s+/g, ' ').trim()));
    const chapters = page.getByRole('navigation', {
      name: 'Read the event introduction',
    });
    await chapters.getByRole('link', { name: 'Join us' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#event-paragraph-3$/);
    await expect(page.locator('#event-paragraph-3')).toBeFocused();
    await expect(
      chapters.getByRole('link', { name: 'Join us' }),
    ).toHaveAttribute('aria-current', 'location');
    const target = (await page.locator('#event-paragraph-3').boundingBox())!;
    expect(target.y).toBeGreaterThanOrEqual(100);
    expect(target.y).toBeLessThan(400);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await size.click();
    await expect(size).toHaveAttribute('aria-pressed', 'false');
  }
});

test('the full blurb precedes project previews and native chapters work without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(baseURL + '/');
  const reader = (await page.locator('[data-event-reader]').boundingBox())!;
  const featured = (await page.locator('.featured-grid').boundingBox())!;
  expect(reader.y + reader.height).toBeLessThan(featured.y);
  await expect(page.getByRole('button', { name: 'Larger text' })).toBeHidden();
  const paragraphs = await page
    .locator('[data-event-paragraph]')
    .allTextContents();
  expect(paragraphs.map((text) => text.replace(/\s+/g, ' ').trim())).toEqual(
    expected.map((text: string) => text.replace(/\s+/g, ' ').trim()),
  );
  await page
    .getByRole('navigation', { name: 'Read the event introduction' })
    .getByRole('link', { name: 'Experience' })
    .click();
  await expect(page).toHaveURL(/#event-paragraph-2$/);
  await expect(page.locator('#event-paragraph-2')).toBeFocused();
  await context.close();
});
