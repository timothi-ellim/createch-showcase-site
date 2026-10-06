import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

test('compact markers preview without navigation and a click pins the work', async ({
  page,
  isMobile,
}) => {
  await page.goto('/explore/?mode=map&room=ws10&view=3d');
  const pin = page.locator('[data-map-pin="social-xr"]');
  const other = page.locator('[data-map-pin="metaflower-the-kiri"]');
  const selected = page.locator('.atlas-selected-project');
  await pin.scrollIntoViewIfNeeded();
  const box = await pin.locator('.atlas-artwork').boundingBox();
  expect(box?.width).toBe(48);
  expect(box?.height).toBe(48);
  await mkdir('docs/evidence/exhibition-map', { recursive: true });
  await page.locator('.atlas-map-panel').screenshot({
    path: `docs/evidence/exhibition-map/compact-${isMobile ? 'mobile' : 'desktop'}.png`,
  });
  if (!isMobile) {
    // Element screenshots may scroll; measure immediately before the interaction.
    await pin.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({
      url: location.href,
      history: history.length,
      y: scrollY,
    }));
    await pin.hover();
    await expect(selected).toHaveAttribute('data-atlas-project', 'social-xr');
    expect(
      await page.evaluate(() => ({
        url: location.href,
        history: history.length,
        y: scrollY,
      })),
    ).toEqual(before);
    await expect(selected.locator('h3')).not.toBeFocused();
    await selected.hover();
    await page.waitForTimeout(550);
    await expect(selected).toHaveAttribute('data-atlas-project', 'social-xr');
    await page
      .locator('.atlas-workspace')
      .screenshot({ path: 'docs/evidence/exhibition-map/compact-hover.png' });
    await page.mouse.move(0, 0);
    await expect(selected).toHaveCount(0);
    await pin.focus();
    await expect(selected).toHaveAttribute('data-atlas-project', 'social-xr');
    await expect(pin).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(selected).toHaveCount(0);
    await expect(pin).toBeFocused();
  }
  await pin.click();
  await expect(page.locator('[data-exhibition-map]')).toHaveAttribute(
    'data-preview-mode',
    'pinned',
  );
  await expect(page).toHaveURL(/project=social-xr/);
  if (!isMobile) {
    await other.hover();
    await page.waitForTimeout(200);
    await expect(selected).toHaveAttribute('data-atlas-project', 'social-xr');
  }
  await selected.locator('[data-save]').click();
  await expect(selected.locator('[data-save]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await selected.getByRole('button', { name: 'Close artwork preview' }).click();
  await expect(selected).toHaveCount(0);
  await expect(pin).toBeFocused();
  await expect(page).not.toHaveURL(/project=/);
  await expect(page.locator('[data-atlas-project]')).toHaveCount(12);
});

test('artist search, visual cards and neighbouring works lead into public profiles', async ({
  page,
}) => {
  await page.goto('/explore/?mode=map&view=3d');
  const search = page.getByRole('searchbox', {
    name: 'Search artists, works or ideas',
  });
  await search.fill('Qilin');
  await expect(page.locator('[data-search-result]:visible')).toHaveCount(1);
  await expect(page.locator('[data-search-count]')).toContainText(
    '1 matching work',
  );
  await page.locator('[data-search-result]:visible').click();
  const selected = page.locator('.atlas-selected-project');
  await expect(selected).toHaveAttribute(
    'data-atlas-project',
    'an-unfinished-body',
  );
  await expect(selected.locator('h3')).toBeFocused();
  await expect(
    page.locator('[data-room-plan="ws09"] [data-map-pin="an-unfinished-body"]'),
  ).toContainText('Qilin Zhang');
  await expect(page.locator('[data-room-plan="ws09"]')).not.toContainText(
    'W9-2',
  );
  await page.locator('[data-clear-search]').click();
  await selected
    .getByRole('button', { name: 'Next work', exact: true })
    .click();
  await expect(selected).toHaveAttribute(
    'data-atlas-project',
    'virtual-theatre',
  );
  await selected
    .getByRole('button', { name: 'Previous work', exact: false })
    .click();
  await expect(selected).toHaveAttribute(
    'data-atlas-project',
    'an-unfinished-body',
  );
  await selected.getByRole('link', { name: 'Explore work & artist' }).click();
  await expect(page).toHaveURL(/\/projects\/an-unfinished-body\//);
  await page.getByRole('link', { name: 'Back to the exhibition map' }).click();
  await expect(
    page.getByRole('button', { name: '3D space', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await search.fill('zz-no-such-work');
  await expect(page.locator('#no-results')).toBeVisible();
  await page.locator('[data-clear-search]').click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await search.fill('XR');
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(selected).toHaveAttribute(
    'data-atlas-project',
    'an-unfinished-body',
  );
});

test('landmarks remain navigable across projection, history and reload', async ({
  page,
}) => {
  await page.goto('/explore/?mode=map&view=3d');
  const cafe = page.locator('[data-overview] [data-landmark-open="cafe"]');
  await cafe.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-landmark-title]')).toHaveText('Public café');
  await expect(page.locator('[data-landmark-title]')).toBeFocused();
  await expect(page).toHaveURL(/landmark=cafe/);
  await expect(page.locator('[data-landmark-note]')).toContainText(
    'not a surveyed counter',
  );
  await page.getByRole('button', { name: 'Rotate 3D view right' }).click();
  await page.reload();
  await expect(page.locator('[data-landmark-title]')).toHaveText('Public café');
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  await expect(page.locator('[data-landmark-detail]')).toBeVisible();
  await page
    .getByRole('button', { name: 'Back to all spaces', exact: true })
    .click();
  await expect(page.locator('[data-map-welcome]')).toBeVisible();
  await page.goBack();
  await expect(page.locator('[data-landmark-title]')).toHaveText('Public café');
  await page.locator('[data-landmark-detail] [data-discover-work]').click();
  await expect(page.locator('.atlas-selected-project')).toBeVisible();
  await expect(
    page.locator('.atlas-selected-project [data-atlas-profile]'),
  ).toBeVisible();
});

test('rooms, keyboard selection, profile round trip and history preserve context', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/explore/?mode=map');
  await expect(page.locator('[data-atlas-project]')).toHaveCount(12);
  await page.getByRole('button', { name: /^WS10 \d+$/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-room-plan="ws10"]')).toBeVisible();
  const pin = page.locator('[data-map-pin="social-xr"]');
  await pin.focus();
  await page.keyboard.press('Enter');
  const selected = page.locator('.atlas-selected-project');
  await expect(selected).toHaveAttribute('data-atlas-project', 'social-xr');
  await expect(selected.locator('h3')).toBeFocused();
  await expect(selected.locator('img')).toBeVisible();
  await expect
    .poll(() =>
      selected
        .locator('img')
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await selected.getByRole('link', { name: 'Explore work & artist' }).click();
  await page.getByRole('link', { name: 'Back to the exhibition map' }).click();
  await expect(page.locator('.atlas-selected-project')).toHaveAttribute(
    'data-atlas-project',
    'social-xr',
  );
  await page.getByRole('button', { name: /^All spaces \d+$/ }).click();
  await page.goBack();
  await expect(page.locator('.atlas-selected-project')).toHaveAttribute(
    'data-atlas-project',
    'social-xr',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-selected-project')).toHaveCount(0);
  await expect(page.locator('[data-atlas-project]')).toHaveCount(12);
  expect(errors).toEqual([]);
});

test('saved highlights share the existing shortlist and survive reload and cross-tab updates', async ({
  page,
}) => {
  await page.goto('/explore/?mode=map&project=listen-scoundrels');
  const selected = page.locator('.atlas-selected-project');
  await selected.locator('[data-save]').click();
  await expect(selected.locator('[data-save]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto(page.url() + '&saved=1');
  await expect(page.locator('[data-map-saved-summary]')).toContainText(
    '1 saved on this map',
  );
  await page.reload();
  await expect(page.getByLabel('Highlight my saved projects')).toBeChecked();
  await expect(page.locator('[data-map-pin="listen-scoundrels"]')).toHaveClass(
    /is-saved/,
  );
  await page.goto('/my-visit/');
  await expect(page.locator('#shortlist-count')).toContainText(
    '1 saved project',
  );
  await page.locator('.atlas-invitation').click();
  await expect(page.locator('[data-room-saved="gallery"]')).toHaveText(
    '1 saved',
  );
  const other = await page.context().newPage();
  await other.goto('/projects/listen-scoundrels/');
  await other.locator('.detail [data-save="listen-scoundrels"]').click();
  await expect(page.locator('[data-map-saved-summary]')).toContainText(
    'No saved projects yet',
  );
  await other.close();
});

test('denied and corrupt storage never reports a false save or prevents browsing', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await page.goto('/explore/?mode=map&project=listen-scoundrels&saved=1');
  await expect(page.locator('[data-map-storage]')).toContainText('unavailable');
  await page.locator('.atlas-selected-project [data-save]').click();
  await expect(page.locator('#status')).toContainText('not saved');
  await expect(
    page.locator('.atlas-selected-project [data-save]'),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-room="ws09"]').click();
  await expect(page.locator('[data-room-plan="ws09"]')).toBeVisible();
  const clean = await page.context().browser()!.newContext();
  const corrupt = await clean.newPage();
  await corrupt.addInitScript(() =>
    localStorage.setItem('createch-shortlist-v1', '{invalid'),
  );
  await corrupt.goto(new URL('/explore/?mode=map&saved=1', page.url()).href);
  await expect(corrupt.locator('[data-map-storage]')).toContainText(
    'could not be read',
  );
  await expect(corrupt.locator('[data-map-saved-summary]')).toContainText(
    'No saved projects',
  );
  await clean.close();
});

test('no-JavaScript directory and links remain usable', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 740 },
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/explore/?mode=map`);
  await expect(page.locator('[data-atlas-profile]')).toHaveCount(12);
  await expect(page.locator('[data-map-controls]')).toBeHidden();
  await page
    .locator('.atlas-fallback-labels [data-room-open="gallery"]')
    .click();
  await expect(page).toHaveURL(/#directory-gallery$/);
  await expect(page.locator('#directory-gallery')).toBeVisible();
  await page.locator('#directory-gallery [data-atlas-profile]').first().click();
  await expect(page).toHaveURL(/\/projects\/listen-scoundrels\//);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test('narrow layouts, touch targets, reduced motion and accessibility', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mkdir('docs/evidence/exhibition-map', { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/explore/?mode=map&room=ws10');
    await expect(page.locator('[data-room-plan="ws10"]')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow at ${width}`,
    ).toBe(true);
    const boxes = await page
      .locator('[data-room-plan="ws10"] [data-map-pin]')
      .evaluateAll((pins) =>
        pins.map((pin) => {
          const r = pin.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        }),
      );
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].width).toBeGreaterThanOrEqual(48);
      expect(boxes[i].height).toBeGreaterThanOrEqual(48);
      for (let j = i + 1; j < boxes.length; j++)
        expect(
          boxes[i].right <= boxes[j].x ||
            boxes[j].right <= boxes[i].x ||
            boxes[i].bottom <= boxes[j].y ||
            boxes[j].bottom <= boxes[i].y,
          `pin overlap at ${width}`,
        ).toBe(true);
    }
    await page.locator('[data-map-controls]').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/evidence/exhibition-map/room-${width}-${info.project.name}.png`,
    });
  }
  await page.goto('/explore/?mode=map');
  const overview = await new AxeBuilder({ page })
    .include('[data-exhibition-map]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(overview.violations).toEqual([]);
  await page.goto('/explore/?mode=map&project=social-xr');
  const selected = await new AxeBuilder({ page })
    .include('[data-exhibition-map]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(selected.violations).toEqual([]);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('.atlas-selected-project')).toBeVisible();
  await page.screenshot({
    path: `docs/evidence/exhibition-map/forced-colors-${info.project.name}.png`,
  });
});

test('unknown locations and failed images retain truthful navigation', async ({
  page,
}) => {
  await page.goto(
    '/explore/?mode=map&project=withdrawn-or-unknown&room=invalid',
  );
  await expect(page.locator('[data-overview]')).toBeVisible();
  await expect(page.locator('[data-map-status]')).toContainText(
    'no proposed position',
  );
  await page.route('**/media/**', (route) => route.abort());
  await page.goto('/explore/?mode=map&project=social-xr');
  await expect(
    page.locator('.atlas-selected-project .atlas-image-error'),
  ).toBeVisible();
  await expect(
    page.locator('.atlas-selected-project [data-atlas-profile]'),
  ).toBeVisible();
});

test('the production content security policy permits map interactions', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|violates the following/.test(message.text()))
      violations.push(message.text());
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      },
    });
  });
  await page.goto('/explore/?mode=map');
  await page.getByRole('button', { name: '3D space', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate 3D view right' }).click();
  await page.getByRole('button', { name: /^Gallery \d+$/ }).click();
  await page.locator('[data-map-pin="listen-scoundrels"]').click();
  await page.locator('.atlas-selected-project [data-save]').click();
  await expect(
    page.locator('.atlas-selected-project [data-save]'),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(violations).toEqual([]);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test('2D and 3D controls retain selection, saves, rotation and profile return context', async ({
  page,
}) => {
  await page.goto('/explore/?mode=map&project=social-xr');
  const selected = page.locator('.atlas-selected-project');
  await selected.locator('[data-save]').click();
  await page.goto(page.url() + '&saved=1');
  const scene = page.locator('[data-room-plan="ws10"]');
  const plan = await scene.locator('[data-scene-faces]').innerHTML();
  const view3d = page.getByRole('button', { name: '3D space', exact: true });
  await view3d.focus();
  await page.keyboard.press('Enter');
  await expect(view3d).toHaveAttribute('aria-pressed', 'true');
  await expect(view3d).toBeFocused();
  expect(await scene.locator('[data-scene-faces]').innerHTML()).not.toEqual(
    plan,
  );
  const initial = await scene.locator('[data-scene-faces]').innerHTML();
  await page.getByRole('button', { name: 'Rotate 3D view right' }).click();
  await expect(page).toHaveURL(/angle=1/);
  expect(await scene.locator('[data-scene-faces]').innerHTML()).not.toEqual(
    initial,
  );
  await expect(selected).toHaveAttribute('data-atlas-project', 'social-xr');
  await expect(selected.locator('[data-save]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await selected.getByRole('link', { name: 'Explore work & artist' }).click();
  await page.getByRole('link', { name: 'Back to the exhibition map' }).click();
  await expect(page).toHaveURL(/view=3d&angle=1/);
  await expect(selected).toHaveAttribute('data-atlas-project', 'social-xr');
  await expect(page.getByLabel('Highlight my saved projects')).toBeChecked();
  await page.getByRole('button', { name: 'Reset view' }).click();
  expect(new URL(page.url()).searchParams.has('angle')).toBe(false);
  await page.getByRole('button', { name: 'Rotate 3D view left' }).click();
  await expect(page).toHaveURL(/angle=3/);
  await page.reload();
  await expect(view3d).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '2D plan', exact: true }).click();
  await expect(page.locator('[data-camera-controls]')).toBeHidden();
  await page.goBack();
  await expect(view3d).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/angle=3/);
});

test('every camera angle keeps mobile labels and installation targets separate and inside the drawing', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const room of ['all', 'gallery', 'ws09', 'ws10']) {
      await page.goto(`/explore/?mode=map&room=${room}&view=3d&saved=1`);
      const scene = page.locator(`[data-atlas-scene="${room}"]`);
      await expect(scene).toHaveClass(/is-projected/);
      for (let angle = 0; angle < 4; angle++) {
        const failures = await scene.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const labels = [
            ...element.querySelectorAll('[data-scene-point]'),
          ].map((label) => ({
            key: label.getAttribute('data-scene-point'),
            rect: label.getBoundingClientRect(),
          }));
          const problems: string[] = [];
          for (let i = 0; i < labels.length; i++) {
            const a = labels[i].rect;
            if (
              a.left < bounds.left ||
              a.right > bounds.right ||
              a.top < bounds.top ||
              a.bottom > bounds.bottom
            )
              problems.push(`out of bounds: ${labels[i].key}`);
            for (let j = i + 1; j < labels.length; j++) {
              const b = labels[j].rect;
              if (
                a.left < b.right &&
                b.left < a.right &&
                a.top < b.bottom &&
                b.top < a.bottom
              )
                problems.push(`overlap: ${labels[i].key}/${labels[j].key}`);
            }
          }
          return problems;
        });
        expect(failures, `${width}px ${room} angle ${angle}`).toEqual([]);
        await page
          .getByRole('button', { name: 'Rotate 3D view right' })
          .click();
      }
    }
  }
  await page.goto('/explore/?mode=map&view=3d&project=social-xr');
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-exhibition-map]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test('Explore combines both views and preserves filters, camera, selection and saves', async ({
  page,
}) => {
  await page.goto('/explore/?q=Qilin&theme=image');
  const projects = page.locator('[data-explore-panel="projects"]');
  const map = page.locator('[data-explore-panel="map"]');
  await expect(projects).toBeVisible();
  await expect(map).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('Qilin');
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(map).toBeVisible();
  await expect(projects).toBeHidden();
  await page.getByRole('button', { name: '3D space', exact: true }).click();
  await page.getByRole('button', { name: /^WS09 \d+$/ }).click();
  await page.locator('[data-map-pin="an-unfinished-body"]').click();
  await page.locator('.atlas-selected-project [data-save]').click();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.locator('#search')).toHaveValue('Qilin');
  await expect(
    page.locator('#filters [data-theme-filter="image"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('#project-results [data-save="an-unfinished-body"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(map).toBeVisible();
  await expect(page.locator('.atlas-selected-project')).toHaveAttribute(
    'data-atlas-project',
    'an-unfinished-body',
  );
  await expect(
    page.getByRole('button', { name: '3D space', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.atlas-selected-project [data-atlas-profile]').click();
  await page.getByRole('link', { name: 'Back to the exhibition map' }).click();
  await expect(page).toHaveURL(/\/explore\//);
  await expect(map).toBeVisible();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.locator('#search')).toHaveValue('Qilin');
  await expect(page.locator('h1')).toHaveCount(1);
  await page.screenshot({
    path: `docs/evidence/exhibition-map/combined-projects-${page.viewportSize()!.width}.png`,
  });
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await page.locator('.explore-views').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/evidence/exhibition-map/combined-map-${page.viewportSize()!.width}.png`,
  });
});

test('old map links preserve installation, saved and camera context', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/map/?project=social-xr&view=3d&angle=2&saved=1');
  await expect(page).toHaveURL(/\/explore\/.*mode=map/);
  await expect(page.locator('.atlas-selected-project')).toHaveAttribute(
    'data-atlas-project',
    'social-xr',
  );
  await expect(page.getByLabel('Highlight my saved projects')).toBeChecked();
  await expect(page).toHaveURL(/angle=2/);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await context.newPage();
  await fallback.goto(`${baseURL}/map/`);
  await fallback
    .getByRole('link', { name: 'Explore projects and the map' })
    .click();
  await expect(fallback.locator('#project-results')).toBeVisible();
  await expect(fallback.locator('[data-exhibition-map]')).toBeVisible();
  await context.close();
});

test('view anchors open the intended panel in a new navigation and support keyboard switching', async ({
  page,
}) => {
  await page.goto('/explore/?mode=projects#explore-map');
  await expect(page.locator('[data-explore-panel="map"]')).toBeVisible();
  const projects = page.getByRole('link', { name: 'Projects', exact: true });
  await projects.focus();
  await page.keyboard.press('Enter');
  await expect(projects).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-explore-panel="projects"]')).toBeVisible();
  await expect(page.locator('[data-explore-panel="map"]')).toBeHidden();
  await expect(projects).toBeFocused();
  await page.goto('/explore/?mode=map#explore-projects');
  await expect(page.locator('[data-explore-panel="projects"]')).toBeVisible();
});
