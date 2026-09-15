import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const KEY = 'createch-shortlist-v1';
const routes = [
  '/',
  '/explore/',
  '/programme/',
  '/about/',
  '/projects/sample-image-study/',
  '/projects/sample-world-study/',
  '/projects/sample-relation-study/',
  '/projects/sample-long-title/',
  '/my-visit/',
  '/visit/',
  '/participants/',
  '/404.html',
];

test('search tolerates extra spaces and clear search preserves the chosen theme', async ({
  page,
}) => {
  await page.goto('/explore/?theme=image');
  await page
    .getByLabel('Search the sample projects')
    .fill('  contributor   a  ');
  await expect(page.locator('#result-count')).toHaveText('1 sample project');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByLabel('Search the sample projects')).toBeFocused();
  await expect(page.locator('#result-count')).toHaveText('2 sample projects');
  await expect(page).toHaveURL(/theme=image/);
  await expect(
    page.getByRole('button', { name: 'Clear search', exact: true }),
  ).toBeHidden();
});

test('filtered exploration returns to the same results and project; sharing omits navigation context', async ({
  page,
}) => {
  await page.goto('/explore/?theme=image&encounter=Participate');
  await page.getByRole('link', { name: 'View 1 project' }).click();
  await expect(page.locator('#result-count')).toBeFocused();
  await page.locator('[data-project-card]:visible [data-project-link]').click();
  await expect(page.locator('[data-back-to-results]')).toHaveText(
    '← Back to your results',
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Denied');
        },
      },
      configurable: true,
    });
  });
  await page.getByRole('button', { name: 'Copy project link' }).click();
  await expect(page.locator('#project-url')).toHaveValue(
    'http://127.0.0.1:4321/projects/sample-long-title/',
  );
  await page.locator('[data-back-to-results]').click();
  await expect(page.locator('#result-count')).toHaveText('1 sample project');
  await expect(page.locator('#project-fixture-04')).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Participate', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('shortlist cleanup preserves valid saves and clear/remove can be undone', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify(['fixture-01', 'fixture-02', 'removed-record']),
      ),
    KEY,
  );
  await page.goto('/my-visit/');
  await page
    .getByRole('button', { name: 'Remove unavailable entries' })
    .click();
  await expect(page.locator('#storage-notice')).toBeEmpty();
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear shortlist' }).click();
  await page.getByRole('button', { name: 'Yes, clear shortlist' }).click();
  await expect(
    page.getByRole('button', { name: 'Print my visit' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Print my visit' }),
  ).toBeEnabled();
  await page.locator('[data-project-card]:visible [data-save]').first().click();
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(2);
  await page
    .locator('[data-project-card]:visible [data-project-link]')
    .first()
    .click();
  await page.getByRole('link', { name: 'Back to my visit' }).click();
  await expect(page.locator('#project-fixture-01')).toBeFocused();
});

test('mobile search submit moves focus to results and unsafe return links are ignored', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.getByLabel('Search the sample projects').fill('contributor b');
  await page.locator('#search').press('Enter');
  await expect(page.locator('#result-count')).toBeFocused();
  await expect(page.locator('#result-count')).toHaveText('1 sample project');
  await page.goto(
    '/projects/sample-world-study/?from=https://example.invalid/explore/',
  );
  await expect(page.locator('[data-back-to-results]')).toHaveAttribute(
    'href',
    '/explore/',
  );
});

test('another tab invalidates undo and moving a focused saved card out of the list recovers focus', async ({
  page,
  context,
}) => {
  await page.goto('/projects/sample-image-study/');
  await page.locator('[data-save]').click();
  await page.goto('/my-visit/');
  await page.getByRole('button', { name: 'Clear shortlist' }).click();
  await expect(
    page.getByRole('button', { name: 'Undo last change' }),
  ).toBeVisible();
  const other = await context.newPage();
  await other.goto('/projects/sample-world-study/');
  await other.locator('[data-save]').click();
  await expect(page.locator('[data-shortlist-undo]')).toBeHidden();
  await page.locator('[data-project-card]:visible [data-save]').focus();
  await other.locator('[data-save]').click();
  await expect(page.locator('#shortlist-empty a')).toBeFocused();
  await other.close();
});

test('all routes render without browser errors and pass automated accessibility checks', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations,
      `${route}: ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`,
    ).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('filters combine, show empty results, clear and restore a shared query', async ({
  page,
}) => {
  await page.goto('/explore/?theme=image');
  await expect(page.locator('#result-count')).toHaveText('2 sample projects');
  await expect(
    page.getByRole('button', { name: 'Image', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Participate', exact: true }).click();
  await expect(page.locator('#result-count')).toHaveText('1 sample project');
  await page.getByLabel('Search the sample projects').fill('nothing-matches');
  await expect(
    page.getByRole('heading', { name: 'No projects match yet.' }),
  ).toBeVisible();
  await page.locator('#no-results button').click();
  await expect(page.locator('#search')).toBeFocused();
  await expect(page.locator('#result-count')).toHaveText('4 sample projects');
  await page.getByLabel('Search the sample projects').fill('contributor b');
  await page.reload();
  await expect(page.locator('#result-count')).toHaveText('1 sample project');
  await page.locator('button[type=reset]').click();
  await expect(page.locator('#result-count')).toHaveText('4 sample projects');
});

test('keyboard navigation exposes skip link, filters, and native details', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.explore-skip')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#search')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Image', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#result-count')).toHaveText('2 sample projects');
  await page.keyboard.press('Shift+Tab');
  await expect(
    page.getByRole('button', { name: 'All themes', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#result-count')).toHaveText('4 sample projects');
  await page.goto('/visit/');
  const summary = page.getByText('Programme & finding projects', {
    exact: true,
  });
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText(
      'Project locations, timings and further visitor guidance are coming soon.',
      {
        exact: false,
      },
    ),
  ).toBeVisible();
  await page.keyboard.press('Space');
  await expect(
    page.getByText(
      'Project locations, timings and further visitor guidance are coming soon.',
      {
        exact: false,
      },
    ),
  ).toBeHidden();
});

test('saving persists through routes and reload; removing restores useful focus', async ({
  page,
}) => {
  await page.goto('/projects/sample-image-study/');
  await page.locator('[data-save]').click();
  await expect(page.locator('[data-save]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY),
  ).toEqual(['fixture-01']);
  await page.reload();
  await expect(page.locator('[data-save]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/my-visit/');
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(1);
  await page.locator('[data-project-card]:visible [data-save]').click();
  await expect(page.locator('#shortlist-empty')).toBeVisible();
  await expect(page.locator('#shortlist-empty a')).toBeFocused();
  await page.reload();
  await expect(page.locator('#shortlist-empty')).toBeVisible();
});

test('corrupt and removed project IDs have recovery states and clear works', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.setItem(key, '{broken'), KEY);
  await page.goto('/my-visit/');
  await expect(page.locator('#storage-notice')).toContainText(
    'could not be read',
  );
  await page.locator('[data-clear-saved]').click();
  await expect(page.locator('#storage-notice')).toBeEmpty();
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify(['removed-project', 'fixture-02']),
      ),
    KEY,
  );
  await page.reload();
  await expect(page.locator('#storage-notice')).toContainText(
    'no longer in this catalogue',
  );
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(1);
  await page.locator('[data-clear-saved]').click();
  await page.getByRole('button', { name: 'Yes, clear shortlist' }).click();
  await expect(page.locator('#shortlist-empty')).toBeVisible();
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), KEY),
  ).toEqual([]);
});

test('denied storage never claims successful saving', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
  });
  await page.goto('/projects/sample-image-study/');
  await page.locator('[data-save]').click();
  await expect(page.locator('#status')).toContainText('not saved');
  await expect(page.locator('[data-save]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.goto('/my-visit/');
  await expect(page.locator('#storage-notice')).toContainText('unavailable');
  await expect(page.locator('#shortlist-empty')).toBeVisible();
});

test('full storage preserves the previous saved state', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(
    (key) => localStorage.setItem(key, JSON.stringify(['fixture-01'])),
    KEY,
  );
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
  });
  await page.goto('/projects/sample-image-study/');
  await page.locator('[data-save]').click();
  await expect(page.locator('#status')).toContainText('not saved');
  await expect(page.locator('[data-save]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('clipboard success and denied clipboard fallback are truthful', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Denied');
        },
      },
      configurable: true,
    });
  });
  await page.goto('/projects/sample-image-study/');
  await page.locator('[data-copy-link]').click();
  await expect(page.locator('#project-url')).toBeVisible();
  await expect(page.locator('#project-url')).toHaveValue(
    /\/projects\/sample-image-study\//,
  );
  await expect(page.locator('#project-url')).toBeFocused();
  await expect(page.locator('#status')).toContainText(
    'Automatic copying is unavailable',
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => {} },
    });
  });
  await page.locator('[data-copy-link]').click();
  await expect(page.locator('#status')).toContainText('Project link copied');
});

test('core routes and all projects remain readable without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const route of [
    '/',
    '/explore/',
    '/projects/sample-image-study/',
    '/my-visit/',
    '/visit/',
    '/participants/',
  ]) {
    await page.goto(`http://127.0.0.1:4321${route}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('footer')).toContainText(
      'Wednesday 28 October 2026',
    );
  }
  await page.goto('http://127.0.0.1:4321/explore/?theme=image');
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(4);
  await expect(page.locator('[data-save]:visible')).toHaveCount(0);
  await page
    .getByRole('link', { name: 'Sample image study', exact: true })
    .click();
  await expect(page.locator('h1')).toHaveText('Sample image study');
  await context.close();
});

test('320, 390, tablet and desktop layouts do not overflow; capture evidence', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chrome',
    'One viewport sweep is sufficient',
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const route of [
      '/',
      '/explore/',
      '/projects/sample-long-title/',
      '/my-visit/',
      '/visit/',
    ]) {
      await page.goto(route);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}px`,
      ).toBe(true);
      await page.screenshot({
        path: `docs/evidence/redesign/fixtures/${width}-${route === '/' ? 'home' : route.split('/').filter(Boolean).join('-')}.png`,
        fullPage: true,
      });
    }
  }
});

test('reduced motion removes decorative transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(
    await page
      .locator('.theme-tile')
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0s');
});

test('saved changes synchronize across tabs in the same browser', async ({
  page,
  context,
}) => {
  await page.goto('/projects/sample-image-study/');
  const other = await context.newPage();
  await other.goto('/my-visit/');
  await page.locator('[data-save]').click();
  await expect(other.locator('[data-project-card]:visible')).toHaveCount(1);
  await other.close();
});

test('Surprise me respects the visible results and disables on no matches', async ({
  page,
}) => {
  await page.goto('/explore/?theme=world');
  await page.getByRole('button', { name: 'Surprise me' }).click();
  await expect(page).toHaveURL(/\/projects\/sample-world-study\//);
  await page.goto('/explore/?q=unfindable-synthetic-query');
  await expect(
    page.getByRole('button', { name: 'Surprise me' }),
  ).toBeDisabled();
});

test('failed project images get a readable fallback', async ({ page }) => {
  await page.route('**/projects/sample-image-study/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /<div class="project-media image">[\s\S]*?<\/div>/,
      '<div class="project-media image"><img src="/missing-test-image.png" alt="Synthetic image used only by this test" width="960" height="640"></div>',
    );
    await route.fulfill({ response, body: html });
  });
  await page.goto('/projects/sample-image-study/');
  await expect(
    page.getByText('Project image unavailable.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('h1')).toHaveText('Sample image study');
});

test('print view keeps only the saved projects and confirmed visit facts', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.locator('[data-save="fixture-02"]').click();
  await page.goto('/my-visit/');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(1);
  await expect(page.locator('[data-print]')).toBeHidden();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.visit-note')).toContainText(
    'Wednesday 28 October 2026',
  );
});
