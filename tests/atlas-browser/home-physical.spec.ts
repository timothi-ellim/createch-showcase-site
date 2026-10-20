import { test, expect } from '@playwright/test';

test('hero controls transfer a response to the artwork frame and background', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Fine pointer hover.');
  await page.goto('/');
  const action = page.locator('.hero .actions a').first();
  await action.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  const box = await action.boundingBox();
  await action.hover();
  expect(await page.locator('.exhibition-window .home-response-plate').evaluate(el =>
    el.getAnimations().some(a => a.id === 'physical-home-frame'))).toBe(true);
  expect(await page.locator('.hero .backdrop-ring').evaluate(el =>
    el.getAnimations().some(a => a.id === 'physical-home-ring'))).toBe(true);
  expect(await action.boundingBox()).toEqual(box);
  await page.mouse.down();
  await page.waitForTimeout(80);
  expect(await page.locator('.exhibition-window .home-response-plate').evaluate(el =>
    el.getAnimations().some(a => a.id === 'physical-home-frame'))).toBe(true);
  expect(await action.getAttribute('href')).toBe('/explore/');
  await page.mouse.move(5, 150);
  await page.mouse.up();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('homepage themes keep stable targets, react together and preserve navigation', async ({ page, isMobile }) => {
  await page.goto('/');
  const theme = page.locator('.home-themes .theme-tile').first();
  await theme.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  const href = await theme.getAttribute('href');
  if (!isMobile) {
    const box = await theme.boundingBox();
    await theme.hover();
    await page.waitForTimeout(120);
    expect(await theme.boundingBox()).toEqual(box);
    expect(await page.locator('.home-themes .backdrop-ring').evaluate(el =>
      el.getAnimations().some(a => a.id === 'physical-home-ring'))).toBe(true);
  }
  await theme.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(href!.replace('?', '\\?') + '$'));
});

test('homepage section seams reveal without moving or hiding content', async ({ page }) => {
  await page.goto('/');
  const projects = page.locator('.home-projects');
  const before = await projects.innerText();
  await projects.scrollIntoViewIfNeeded();
  await expect(projects.locator('.home-section-seam')).toHaveAttribute('aria-hidden', 'true');
  await expect(projects).toHaveAttribute('data-home-arrived', '');
  expect(await projects.innerText()).toBe(before);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.id.startsWith('physical-home-')).length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('homepage response stops on reduced motion and pause; gallery still works', async ({ page }) => {
  await page.goto('/');
  const gallery = page.locator('[data-open-gallery]');
  await gallery.scrollIntoViewIfNeeded();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gallery.click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.id.startsWith('physical-home-')).length)).toBe(0);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('[data-motion-toggle]').click();
  await gallery.click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter(a => a.id.startsWith('physical-home-')).length)).toBe(0);
});
