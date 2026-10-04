import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const paths = '[data-sketch-line]';
async function signature(page: import('@playwright/test').Page) {
  return page
    .locator(paths)
    .evaluateAll((lines) =>
      lines.map((line) => line.getAttribute('d')).join('|'),
    );
}

test('pointer sculpture responds, settles, pauses and honours a changed motion preference', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'desktop-chrome',
    'Fine-pointer interaction; touch controls covered separately.',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.locator('[data-sketch-stage]').scrollIntoViewIfNeeded();
  const bounds = (await page.locator('[data-sketch-stage]').boundingBox())!;
  const before = await signature(page);
  await page.mouse.move(
    bounds.x + bounds.width * 0.8,
    bounds.y + bounds.height * 0.65,
  );
  await page.waitForTimeout(220);
  const intermediate = await signature(page);
  expect(intermediate).not.toBe(before);
  await page.waitForTimeout(800);
  const settled = await signature(page);
  expect(settled).not.toBe(intermediate);
  await page.waitForTimeout(200);
  expect(await signature(page)).toBe(settled);
  await page
    .getByRole('button', { name: 'Pause animations', exact: true })
    .click();
  await page.locator('[data-sketch-stage]').scrollIntoViewIfNeeded();
  const paused = await signature(page);
  await page.mouse.move(bounds.x + 50, bounds.y + 100);
  await page.waitForTimeout(200);
  expect(await signature(page)).toBe(paused);
  await page
    .getByRole('button', { name: 'Resume animations', exact: true })
    .click();
  await page.locator('[data-sketch-stage]').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Bloom', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(
    page.getByRole('button', { name: 'Reduced motion on' }),
  ).toBeDisabled();
  const reduced = await signature(page);
  await page.waitForTimeout(350);
  expect(await signature(page)).toBe(reduced);
  await page.getByRole('button', { name: 'Wave', exact: true }).click();
  expect(await signature(page)).not.toBe(reduced);
  const wave = await signature(page);
  await page.waitForTimeout(180);
  expect(await signature(page)).toBe(wave);
});

test('shape and turn controls work by keyboard and preserve narrow layouts', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#play');
  await page.getByRole('button', { name: 'Bloom', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Bloom', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const before = await signature(page);
  await page.getByRole('button', { name: 'Turn the sculpture' }).focus();
  await page.keyboard.press('Space');
  expect(await signature(page)).not.toBe(before);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (await new AxeBuilder({ page }).include('#play').analyze()).violations,
  ).toEqual([]);
});

test('touch buttons animate without taking over vertical scrolling', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(baseURL + '/#play');
  const before = await signature(page);
  await page.getByRole('button', { name: 'Wave', exact: true }).tap();
  await expect(
    page.getByRole('button', { name: 'Wave', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1000);
  expect(await signature(page)).not.toBe(before);
  const wave = await signature(page);
  await page.getByRole('button', { name: 'Turn the sculpture' }).tap();
  await page.waitForTimeout(800);
  expect(await signature(page)).not.toBe(wave);
  expect(
    await page
      .locator('[data-sketch-stage]')
      .evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe('auto');
  await expect(page.locator('[data-sketch-instructions]')).toContainText(
    'Tap a shape',
  );
  await context.close();
});

test('static sketch and reading remain available without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(baseURL + '/#play');
  await expect(page.locator('.sketch-drawing')).toBeVisible();
  await expect(page.locator(paths)).toHaveCount(22);
  await expect(page.locator('[data-sketch-controls]')).toBeHidden();
  await expect(page.locator('[data-sketch-instructions]')).toBeHidden();
  await expect(page.locator('h1')).toContainText('Where');
  await context.close();
});

test('pause works when storage is denied and leaving the viewport stops a morph', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('Denied', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('Denied', 'SecurityError');
    };
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/#play');
  await page.getByRole('button', { name: 'Bloom', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const stopped = await signature(page);
  await page.waitForTimeout(300);
  expect(await signature(page)).toBe(stopped);
  await page
    .getByRole('button', { name: 'Pause animations', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Resume animations', exact: true }),
  ).toBeVisible();
  await page.locator('[data-sketch-stage]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-sketch-instructions]')).toContainText(
    'Motion is paused',
  );
});
