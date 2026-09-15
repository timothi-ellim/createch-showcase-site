import { test, expect } from '@playwright/test';

test('project media preserves discovery context and save labels keep their width', async ({
  page,
}) => {
  await page.goto('/explore/?theme=image&sort=title');
  const card = page.locator('[data-project-card]:visible').first();
  const media = card.locator('[data-project-media-link]');
  await expect(media).toHaveAttribute('tabindex', '-1');
  expect(await media.getAttribute('href')).toBe(
    await card.locator('[data-project-link]').getAttribute('href'),
  );
  const save = card.locator('[data-save]');
  const before = (await save.boundingBox())!.width;
  await save.click();
  await expect(save).toHaveText('✓ Saved');
  await page.waitForTimeout(250);
  expect((await save.boundingBox())!.width).toBe(before);
  await media.click();
  await page.locator('[data-back-to-results]').click();
  await expect(page).toHaveURL(/theme=image.*sort=title/);
  await expect(page.locator('[data-project-card]:focus')).toHaveCount(1);
});

test('menu exit renders intermediate frames and interruption restores focus and scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');
  const trigger = page.locator('[data-menu-open]');
  const menu = page.locator('#mobile-menu');
  await trigger.click();
  await page.waitForTimeout(250);
  const frames = await menu.evaluate(async (element) => {
    const samples: number[] = [];
    element.querySelector<HTMLButtonElement>('[data-menu-close]')!.click();
    await new Promise<void>((resolve) => {
      const sample = () => {
        if (!(element as HTMLDialogElement).open) {
          resolve();
          return;
        }
        samples.push(Number(getComputedStyle(element).opacity));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return samples;
  });
  expect(frames.some((value) => value > 0 && value < 1)).toBe(true);
  expect(new Set(frames).size).toBeGreaterThan(2);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await trigger.click();
  await menu
    .locator('[data-menu-close]')
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(
    await page.evaluate(() =>
      document.documentElement.classList.contains('menu-open'),
    ),
  ).toBe(false);
  await trigger.click();
  expect(await menu.evaluate((element) => element.getAnimations().length)).toBe(
    0,
  );
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
});

test('mobile search clearing keeps controls stable and compact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explore/');
  const form = page.locator('#filters');
  const height = (await form.boundingBox())!.height;
  expect(height).toBeLessThan(550);
  await page.locator('#search').fill('image');
  expect((await form.boundingBox())!.height).toBe(height);
  await page.locator('[data-clear-search]').click();
  await expect(page.locator('#search')).toHaveValue('');
  expect((await form.boundingBox())!.height).toBe(height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('short laptop hero keeps the main discovery action in view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.locator('.hero .actions a').first()).toBeInViewport({
    ratio: 1,
  });
});

test('poster and saved-count feedback have visible frames and settle with reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    (window as any).polishFrames = { poster: [], count: [] };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      const key = this.matches('.poster-star')
        ? 'poster'
        : this.matches('.visit-utility [data-saved-count]')
          ? 'count'
          : '';
      if (key) {
        const element = this;
        const sample = () => {
          (window as any).polishFrames[key].push(
            getComputedStyle(element).transform,
          );
          if (animation.playState === 'running') requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }
      return animation;
    };
  });
  await page.goto('/');
  await page.waitForTimeout(800);
  expect(
    await page.evaluate(
      () => new Set((window as any).polishFrames.poster).size,
    ),
  ).toBeGreaterThan(3);
  await page.locator('[data-save]').first().click();
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() => new Set((window as any).polishFrames.count).size),
  ).toBeGreaterThan(2);
  await expect(page.locator('.visit-utility [data-saved-count]')).toHaveText(
    '1',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-save]').first().click();
  await expect(page.locator('.visit-utility [data-saved-count]')).toBeEmpty();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
