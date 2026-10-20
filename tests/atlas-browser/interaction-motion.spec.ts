import { test, expect } from '@playwright/test';

for (const surface of ['detail', 'map', 'viewer']) {
  test(`${surface} save keeps its geometry and readable contrast during feedback`, async ({
    page,
  }) => {
    await page.goto('/explore/');
    if (surface === 'map') {
      await page
        .locator('#project-results [data-locate-project]')
        .first()
        .click();
    } else {
      await page
        .locator('#project-results [data-project-link]')
        .first()
        .click();
      if (surface === 'viewer')
        await page.locator('[data-open-artwork]:visible').first().click();
    }
    const selector =
      surface === 'map'
        ? '.atlas-selected-project [data-save]'
        : surface === 'viewer'
          ? '[data-artwork-viewer] [data-save]:visible'
          : '.detail-actions [data-save]';
    const button = page.locator(selector).first();
    await button.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const result = await button.evaluate((el) => {
      const start = el.getBoundingClientRect();
      (el as HTMLButtonElement).click();
      const end = el.getBoundingClientRect();
      const luminance = (color: string) => {
        const rgb = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      let background = getComputedStyle(el).backgroundColor;
      let ancestor = el.parentElement;
      while (background === 'rgba(0, 0, 0, 0)' && ancestor) {
        background = getComputedStyle(ancestor).backgroundColor;
        ancestor = ancestor.parentElement;
      }
      const fg = luminance(getComputedStyle(el).color);
      const bg = luminance(background);
      return {
        stable:
          start.x === end.x &&
          start.width === end.width &&
          start.height === end.height,
        contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
      };
    });
    expect(result.stable).toBe(true);
    expect(result.contrast).toBeGreaterThanOrEqual(4.5);
  });
}

test('successful save has a visible icon response without moving its hit area', async ({
  page,
}) => {
  await page.goto('/explore/');
  const button = page.locator('#project-results [data-save]').first();
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const state = await button.evaluate((el) => {
    const before = el.getBoundingClientRect();
    (el as HTMLButtonElement).click();
    const after = el.getBoundingClientRect();
    return {
      iconMoves: el.querySelector('.save-symbol')?.getAnimations().length ?? 0,
      effects: el.getAnimations().length,
      stable:
        before.x === after.x &&
        before.y === after.y &&
        before.width === after.width,
    };
  });
  expect(state.iconMoves).toBeGreaterThan(0);
  expect(state.effects).toBeGreaterThan(0);
  expect(state.stable).toBe(true);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(700);
  expect(
    await button.evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
});

test('theme choice moves its indicator and transitions results once, with immediate data', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.locator('.filter-drawer summary').click();
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
    document
      .querySelector<HTMLButtonElement>('[data-theme-filter="world"]')!
      .click();
    return {
      indicator:
        document.querySelector('.theme-selection-indicator')?.getAnimations()
          .length ?? 0,
      grid: document.querySelector('#project-results')!.getAnimations().length,
      themes: [
        ...document.querySelectorAll<HTMLElement>(
          '#project-results [data-project-card]:not([hidden])',
        ),
      ].map((el) => el.dataset.theme),
    };
  });
  expect(state.indicator).toBeGreaterThan(0);
  expect(state.grid).toBe(1);
  expect(state.themes.length).toBeGreaterThan(0);
  expect(state.themes.every((theme) => theme === 'world')).toBe(true);
  await page.locator('[data-theme-filter="image"]').click();
  await page.waitForTimeout(700);
  expect(
    await page
      .locator('#project-results')
      .evaluate((el) => el.getAnimations().length),
  ).toBe(0);
});

test('Locate coordinates selected marker and panel; reduced motion cancels both', async ({
  page,
}) => {
  await page.goto('/explore/');
  const locate = page.locator('#project-results [data-locate-project]').first();
  await locate.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const state = await locate.evaluate((el) => {
    (el as HTMLAnchorElement).click();
    return {
      marker: [
        ...document.querySelectorAll(
          '.atlas-pin[aria-current="true"] > .atlas-artwork',
        ),
      ].some((el) => el.getAnimations().length > 0),
      panel: document
        .querySelector('.atlas-selected-project [data-preview-bar]')!
        .getAnimations().length,
    };
  });
  expect(state.marker).toBe(true);
  expect(state.panel).toBeGreaterThan(0);
  await expect(page.locator('.atlas-selected-project h3')).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [
            ...document.querySelectorAll(
              '.atlas-pin > .atlas-artwork, [data-preview-bar]',
            ),
          ].flatMap((el) => el.getAnimations()).length,
      ),
    )
    .toBe(0);
  await page.goBack();
  await page.locator('#project-results [data-save]').first().click();
  expect(
    await page
      .locator('#project-results [data-save]')
      .first()
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
});
