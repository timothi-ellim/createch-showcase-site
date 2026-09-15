import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const KEY = 'createch-shortlist-v1';

test('mobile menu traps focus, closes with Escape and navigation, and unlocks on resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Menu' });
  const menu = page.getByRole('dialog', { name: 'Find your way' });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const close = menu.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).overflow,
    ),
  ).toBe('hidden');
  await page.keyboard.press('Shift+Tab');
  await expect(menu.getByRole('link', { name: 'My visit' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await menu.getByRole('link', { name: 'Programme' }).click();
  await expect(page).toHaveURL('/programme/');
  await expect(
    page.getByRole('heading', { name: 'Programme publishing soon.' }),
  ).toBeVisible();
  await trigger.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(menu).not.toBeVisible();
  await expect(page.locator('.public-header .brand')).toBeFocused();
  expect(
    await page.evaluate(() =>
      document.documentElement.classList.contains('menu-open'),
    ),
  ).toBe(false);
});

test('sorting persists through search and return; reset restores featured order', async ({
  page,
}) => {
  await page.goto('/explore/');
  const cards = page.locator('#project-results [data-project-card]');
  const original = await cards.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-id')),
  );
  await page.getByLabel('Sort projects').selectOption('title');
  const titles = await cards.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-title')!),
  );
  expect(titles).toEqual(
    [...titles].sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' }),
    ),
  );
  await page.locator('#search').fill('Participate');
  await expect(page.locator('#result-count')).toHaveText('2 sample projects');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByLabel('Sort projects')).toHaveValue('title');
  await page.reload();
  await expect(page.getByLabel('Sort projects')).toHaveValue('title');
  await page
    .getByRole('button', { name: 'Clear all filters', exact: true })
    .first()
    .click();
  expect(
    await cards.evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-id')),
    ),
  ).toEqual(original);
  await expect(page).not.toHaveURL(/sort=/);
});

test('bulk clear can be cancelled, confirmed, undone, and invalidated by another tab', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(
    (key) =>
      localStorage.setItem(key, JSON.stringify(['fixture-01', 'fixture-02'])),
    KEY,
  );
  await page.goto('/my-visit/');
  await expect(page.locator('.visit-utility [data-saved-count]')).toHaveText(
    '2',
  );
  const clear = page.getByRole('button', {
    name: 'Clear shortlist',
    exact: true,
  });
  await clear.click();
  await page.getByRole('button', { name: 'Keep my shortlist' }).click();
  await expect(clear).toBeFocused();
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(2);
  await clear.click();
  await page.keyboard.press('Escape');
  await expect(clear).toBeFocused();
  await clear.click();
  await page.getByRole('button', { name: 'Yes, clear shortlist' }).click();
  await expect(page.locator('#shortlist-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(2);
  await clear.click();
  const other = await context.newPage();
  await other.goto('/projects/sample-image-study/');
  await other.locator('[data-save]').click();
  await expect(page.locator('[data-clear-dialog]')).not.toBeVisible();
  await expect(page.locator('.visit-utility [data-saved-count]')).toHaveText(
    '1',
  );
  await other.close();
});

test('home discovery selects only a project in the build; project facts precede long reading', async ({
  page,
}) => {
  await page.goto('/');
  const paths = JSON.parse(
    (await page
      .locator('[data-home-surprise]')
      .getAttribute('data-project-paths')) ?? '[]',
  );
  await page.getByRole('button', { name: 'Surprise me' }).click();
  expect(paths).toContain(new URL(page.url()).pathname);
  const classes = await page
    .locator('[data-project-body] > *')
    .evaluateAll((items) => items.map((item) => item.className));
  expect(classes).toEqual([
    'detail-identity',
    'reading-panel',
    'detail-reading',
  ]);
});

test('no-JS mobile retains every navigation destination and new routes', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 720 },
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4321/');
  for (const name of ['Explore', 'Programme', 'Visit', 'About'])
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation', exact: true })
        .getByRole('link', { name, exact: true }),
    ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('link', { name: 'About', exact: true })
    .click();
  await expect(page.locator('h1')).toContainText('Where Code Becomes Culture');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test('eight responsive widths and short landscape preserve core layouts', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile-chrome',
    'One complete width sweep covers both projects.',
  );
  for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      '/',
      '/explore/',
      '/projects/sample-long-title/',
      '/programme/',
      '/about/',
      '/visit/',
      '/my-visit/',
    ]) {
      await page.goto(route);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}`,
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: 'My visit' })
    .click();
  await expect(page.locator('h1')).toHaveText('My visit.');
});
