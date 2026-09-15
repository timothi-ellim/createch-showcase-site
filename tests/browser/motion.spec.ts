import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { basename, join } from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    (window as any).motionCalls = [];
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      (window as any).motionCalls.push({
        target: this.className,
        text: this.textContent?.trim(),
        save: this.getAttribute('data-save'),
        timing: animation.effect?.getTiming(),
      });
      return animation;
    };
  });
});
test('hero is readable, bounded, stops on reduced preference and has no settled loops', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.hero .actions a').first()).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => (window as any).motionCalls.length))
    .toBeGreaterThan(0);
  const calls = await page.evaluate(() =>
    (window as any).motionCalls.filter((x: any) =>
      String(x.target).includes('title-word'),
    ),
  );
  expect(new Set(calls.map((call: any) => call.text)).size).toBe(4);
  expect(
    Math.max(...calls.map((x: any) => x.timing.delay + x.timing.duration)),
  ).toBeLessThanOrEqual(700);
  await expect(page.locator('h1')).toHaveAccessibleName(
    'Where Code Becomes Culture',
  );
  await expect(page.locator('h1')).toContainText('Code');
  await expect(page.locator('.code-pixels')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBe(0);
  expect(
    await page
      .locator('.pixel-word')
      .evaluate((e) => getComputedStyle(e).transform),
  ).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
test('a hidden initial tab starts once when visible, and reduced preference can be disabled in-session', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).hiddenForTest = true;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => (window as any).hiddenForTest,
    });
  });
  await page.goto('/');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).motionCalls.length)).toBe(0);
  await page.evaluate(() => {
    (window as any).hiddenForTest = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBeGreaterThan(0);
  await page.waitForTimeout(750);
  const count = await page.evaluate(() => (window as any).motionCalls.length);
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  expect(await page.evaluate(() => (window as any).motionCalls.length)).toBe(
    count,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.evaluate(() => {
    (window as any).hiddenForTest = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBeGreaterThan(0);
});

test('hero produces visible intermediate frames before it settles', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const frames: string[] = [];
    (window as any).heroFrames = frames;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const result = animate.call(this, keyframes, options);
      if (
        this.matches('.title-word:first-child') &&
        !(window as any).samplingHero
      ) {
        (window as any).samplingHero = true;
        const element = this;
        const until = performance.now() + 700;
        const sample = () => {
          frames.push(getComputedStyle(element).transform);
          if (performance.now() < until) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }
      return result;
    };
  });
  await page.goto('/');
  await page.waitForTimeout(850);
  const samples = await page.evaluate(
    () => (window as any).heroFrames as string[],
  );
  expect(new Set(samples).size).toBeGreaterThan(3);
  const translations = samples
    .filter((s) => s.startsWith('matrix('))
    .map((s) => Number(s.slice(7, -1).split(',')[5]));
  expect(Math.max(...translations)).toBeGreaterThan(10);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('failed motion load and reduced motion keep public content visible', async ({
  page,
}) => {
  await page.route('**/editorial.*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.hero .actions a').first()).toBeVisible();
  expect(
    await page.locator('h1').evaluate((e) => getComputedStyle(e).opacity),
  ).toBe('1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/projects/sample-long-title/');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(page.locator('h1')).toBeVisible();
});
test('latest filters, search and reset win immediately during transitions', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Image', exact: true }).click();
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await page.getByRole('button', { name: 'Relation', exact: true }).click();
  await expect(page.locator('#result-count')).toHaveText('1 sample project');
  await page.getByLabel('Search the sample projects').fill('no such thing');
  await expect(page.locator('#result-count')).toHaveText('0 sample projects');
  await page
    .getByRole('button', { name: 'Clear all filters', exact: true })
    .first()
    .click();
  await expect(page.locator('#result-count')).toHaveText('4 sample projects');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(4);
});
test('save feedback follows storage success; rapid remove and denied storage remain truthful', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.waitForTimeout(150);
  const save = page.locator('[data-save]').first();
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.evaluate(() =>
      (window as any).motionCalls.some((c: any) => c.save),
    ),
  ).toBe(true);
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('denied');
    };
    (window as any).motionCalls = [];
  });
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  expect(
    await page.evaluate(
      () => (window as any).motionCalls.filter((c: any) => c.save).length,
    ),
  ).toBe(0);
  await expect(page.locator('#status')).toContainText('not saved');
});
test('section reveals run once; hidden lifecycle and resize settle pending work', async ({
  page,
}) => {
  await page.goto('/');
  const heading = page.locator('[data-motion-reveal]').first();
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toHaveAttribute('data-motion-seen', 'true');
  const before = await page.evaluate(() => (window as any).motionCalls.length);
  await page.evaluate(() => scrollTo(0, 0));
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).motionCalls.length)).toBe(
    before,
  );
  await page.goto('/');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
test('disclosures, forced colours, text spacing and CSS zoom preserve usable layout', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/visit/');
  const summary = page.locator('summary').first();
  await summary.click();
  await summary.click();
  await summary.click();
  await expect(summary.locator('..')).not.toHaveAttribute('open');
  await summary.click();
  await expect(summary.locator('..')).toHaveAttribute('open', '');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.addStyleTag({
      content:
        'p{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}',
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  for (const zoom of ['2', '4']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(
      (value) => (document.documentElement.style.zoom = value),
      zoom,
    );
    await expect(summary).toBeVisible();
  }
});
test('route-loaded motion bundles meet gzip budgets', async ({ page }) => {
  for (const [path, budget] of [
    ['/', 12],
    ['/explore/', 15],
    ['/projects/sample-image-study/', 8],
    ['/my-visit/', 5],
    ['/visit/', 3],
    ['/participant/editor/', 10],
    ['/organiser/', 5],
  ] as const) {
    const files = new Set<string>();
    const onRequest = (request: any) => {
      const name = basename(new URL(request.url()).pathname);
      if (/^(boot|editorial|feedback|tokens)\..*\.js$/.test(name))
        files.add(name);
    };
    page.on('request', onRequest);
    await page.goto(path);
    await page.waitForTimeout(200);
    page.off('request', onRequest);
    const bytes = [...files].reduce(
      (sum, f) =>
        sum + gzipSync(readFileSync(join('local-dist', '_astro', f))).length,
      0,
    );
    expect(bytes, `${path}: ${bytes} gzip bytes`).toBeLessThanOrEqual(
      budget * 1024,
    );
    if (path === '/visit/' || path.startsWith('/organiser/'))
      expect([...files].some((f) => f.startsWith('editorial.'))).toBe(false);
  }
});
