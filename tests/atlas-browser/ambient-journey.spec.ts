import { test, expect } from '@playwright/test';

test('public information pages share decorative streams and the common transition', async ({ page }) => {
  for (const path of ['/visit/', '/my-visit/', '/about/', '/programme/', '/participants/', '/privacy/', '/poster/', '/sharing/', '/reminders/', '/reminder-privacy/', '/404.html']) {
    await page.goto(path);
    const scene = page.locator('canvas[data-living-field]').first();
    await expect(scene).toHaveCount(1);
    await expect(scene).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('link[href="/journey.css"]')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
  }
});

test('Plan your visit streams move, pause and remain hidden in print', async ({ page }) => {
  await page.goto('/visit/');
  const scene = page.locator('.venue-type canvas[data-living-field]');
  await expect(scene).toHaveCount(1);
  await scene.scrollIntoViewIfNeeded();
  const sample = () => scene.evaluate(el => (el as HTMLCanvasElement).toDataURL());
  const before = await sample(); await page.waitForTimeout(180);
  expect(await sample()).not.toBe(before);
  await page.locator('[data-motion-toggle]').click();
  await page.waitForTimeout(100); const paused = await sample(); await page.waitForTimeout(180);
  expect(await sample()).toBe(paused);
  await page.emulateMedia({ media: 'print' });
  await expect(scene).toBeHidden();
});

test('visit and shortlist navigation animate while saved projects, undo and artwork remain usable', async ({ page }) => {
  await page.addInitScript(() => addEventListener('pagereveal', event => {
    const transition = Reflect.get(event, 'viewTransition');
    transition?.ready.then(() => {
      Reflect.set(window, 'journeyReady', true);
      Reflect.set(window, 'journeyArtwork', !!document.querySelector('[data-journey-art]'));
    }, () => Reflect.set(window, 'journeyReady', false));
  }));
  await page.goto('/');
  await page.locator('.hero a[href="/visit/"]').click();
  await expect(page).toHaveURL(/\/visit\/$/);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'journeyReady'))).toBe(true);
  await page.locator('.public-header a[href="/my-visit/"]').click();
  await expect(page).toHaveURL(/\/my-visit\/$/);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'journeyReady'))).toBe(true);
  await expect(page.locator('#shortlist-empty')).toBeVisible();
  await page.locator('#shortlist-empty a').click();
  await page.locator('#search').fill('Qilin');
  await page.locator('#project-results [data-save]:visible').first().click();
  await page.locator('.public-header a[href="/my-visit/"]').click();
  const card = page.locator('[data-project-card]:visible');
  await expect(card).toHaveCount(1);
  await card.locator('[data-save]').click();
  await expect(page.locator('#shortlist-empty')).toBeVisible();
  await page.locator('[data-undo-saved]').click();
  await expect(card).toHaveCount(1);
  const artwork = card.locator('.project-media img');
  await artwork.scrollIntoViewIfNeeded();
  await expect.poll(() => artwork.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await card.locator('[data-project-link]').first().click();
  await expect(page.locator('h1')).toContainText('An Unfinished Body');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'journeyReady'))).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, 'journeyArtwork'))).toBe(true);
  await page.waitForTimeout(600);
  await expect(page.locator('[data-journey-art]')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(1);
});

test('ambient scene moves at rest, reacts to input and stops on pause', async ({ page }) => {
  await page.goto('/');
  const scene = page.locator('.hero canvas[data-living-field]');
  await expect(scene).toHaveCount(1);
  await scene.scrollIntoViewIfNeeded();
  const sample = () => scene.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  const before = await sample(); await page.waitForTimeout(160);
  expect(await sample()).not.toBe(before);
  await page.locator('.hero .actions a').first().dispatchEvent('pointermove', { clientX: 180, clientY: 350, pointerType: 'mouse' });
  await page.locator('[data-motion-toggle]').click();
  await page.waitForTimeout(100); const paused = await sample(); await page.waitForTimeout(160);
  expect(await sample()).toBe(paused);
  await expect(scene).toHaveAttribute('data-running', 'false');
  await page.locator('[data-motion-toggle]').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(scene).toHaveAttribute('data-running', 'false');
});

test('homepage Explore project and Back retain content, native history and transition cleanup', async ({ page }) => {
  await page.addInitScript(() => {
    addEventListener('pagereveal', (event) => {
      const transition = Reflect.get(event, 'viewTransition');
      if (transition) transition.ready.then(() => {
        Reflect.set(window, 'journeyReady', true);
        Reflect.set(window, 'journeyArtwork', !!document.querySelector('[data-journey-art]'));
      }, () => { Reflect.set(window, 'journeyReady', false); });
    });
  });
  await page.goto('/');
  await page.locator('.hero .actions a').first().click();
  await expect(page).toHaveURL(/\/explore\/$/);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'journeyReady'))).toBe(true);
  await page.locator('#search').fill('Qilin');
  const link = page.locator('#project-results [data-project-link]:visible').first();
  const href = await link.getAttribute('href');
  await link.click(); await expect(page).toHaveURL(new URL(href!, page.url()).href);
  await expect(page.locator('h1')).toContainText('An Unfinished Body');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'journeyReady'))).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, 'journeyArtwork'))).toBe(true);
  await page.waitForTimeout(600);
  expect(await page.locator('[data-journey-art]').count()).toBe(0);
  await page.goBack(); await expect(page).toHaveURL(/\/explore\//);
  await expect(page.locator('#search')).toHaveValue('Qilin');
  await page.waitForTimeout(600);
  expect(await page.locator('[data-journey-art]').count()).toBe(0);
  await expect(page.locator('canvas[data-living-field]').first()).toHaveAttribute('aria-hidden', 'true');
});

test('paused navigation and unavailable session storage retain working page links', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage unavailable'); } });
    localStorage.setItem('createch-motion-paused', 'true');
  });
  await page.goto('/');
  await page.locator('.hero .actions a').first().click();
  await expect(page).toHaveURL(/\/explore\/$/);
  for(const scene of await page.locator('canvas[data-living-field]').all()) await expect(scene).toHaveAttribute('data-running', 'false');
  await expect(page.locator('html')).not.toHaveAttribute('data-journey-active');
  await page.locator('[data-motion-toggle]').click();
  await page.locator('#search').fill('Qilin');
  await page.locator('#project-results [data-project-link]:visible').first().click();
  await expect(page.locator('h1')).toContainText('An Unfinished Body');
});
