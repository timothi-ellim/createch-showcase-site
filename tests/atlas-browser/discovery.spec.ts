import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('one search and saved filter drive both views and locate preserves context', async ({
  page,
}) => {
  await page.goto('/explore/');
  await expect(page.getByRole('searchbox')).toHaveCount(1);
  await page.locator('#search').fill('Qilin');
  await expect(
    page.locator('#project-results [data-project-card]:visible'),
  ).toHaveCount(1);
  await expect(page.locator('#result-count')).toHaveText('1 project');
  await page.locator('[data-locate-project="an-unfinished-body"]').click();
  await expect(page.locator('.atlas-selected-project')).toHaveAttribute(
    'data-atlas-project',
    'an-unfinished-body',
  );
  await expect(page).toHaveURL(/q=Qilin/);
  await expect(page.locator('[data-map-pin="virtual-theatre"]')).toHaveClass(
    /is-filtered-out/,
  );
  await page.locator('.atlas-selected-project [data-save]').click();
  await page.locator('[data-clear-search]').click();
  await page.locator('.filter-drawer summary').click();
  await page.locator('[data-explore-saved]').check();
  await expect(page.locator('#result-count')).toHaveText('1 project');
  await page.keyboard.press('Escape');
  await expect(page.locator('.filter-drawer')).not.toHaveAttribute('open');
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(
    page.locator('#project-results [data-project-card]:visible'),
  ).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#result-count')).toHaveText('1 project');
  await page
    .locator('#project-results [data-save="an-unfinished-body"]')
    .click();
  await expect(page.locator('#no-results')).toBeVisible();
  await page.locator('[data-reset-filters]').click();
  await expect(page.locator('#result-count')).toHaveText('12 projects');
});

test('compact layout, filter drawer and shared controls remain accessible', async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/explore/');
    expect(
      (await page.locator('.project-card').first().boundingBox())!.y,
    ).toBeLessThan(520);
    await page.locator('.filter-drawer summary').click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator('[data-theme-filter="world"]').click();
    await page.locator('[data-view-results]').click();
    await expect(page.locator('.filter-drawer')).not.toHaveAttribute('open');
    await page.getByRole('link', { name: 'Map', exact: true }).click();
    await expect(
      page.locator('.atlas-room-hit.has-filter-matches').first(),
    ).toBeVisible();
    await expect(page.locator('[data-search-result]:visible')).not.toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test('selecting a marker does not jump the mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explore/?mode=map&room=ws10');
  const marker = page.locator('[data-map-pin="social-xr"]');
  await marker.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => scrollY);
  await marker.click();
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(3);
  await expect(page.locator('.atlas-selected-project')).toHaveAttribute(
    'data-atlas-project',
    'social-xr',
  );
  await expect(
    page.locator('.atlas-selected-project [data-atlas-profile]'),
  ).toBeVisible();
});
