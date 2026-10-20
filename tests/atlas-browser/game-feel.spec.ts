import { test, expect } from '@playwright/test';
const key = 'createch-shortlist-v1';

test('save feedback stays beside its control and repeats truthfully', async ({
  page,
}) => {
  await page.goto('/explore/');
  const card = page.locator('#project-results [data-project-card]').first();
  const button = card.locator('[data-save]');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('[data-save-notice]')).toHaveText(
    'Saved on this device.',
  );
  await expect(button).toHaveAttribute('aria-describedby', /save-notice/);
  await button.click();
  await expect(card.locator('[data-save-notice]')).toHaveText(
    'Removed from My visit.',
  );
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await page.reload();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('[data-save-notice]')).toBeEmpty();
});

test('denied save keeps an inspectable local error after transient announcements', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
  });
  const card = page.locator('#project-results [data-project-card]').first();
  await card.locator('[data-save]').click();
  await expect(card.locator('[data-save]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(card.locator('[data-save-notice]')).toContainText('Not saved.');
  await page.waitForTimeout(6700);
  await expect(card.locator('[data-save-notice]')).toContainText('Try again');
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
});

test('filter updates do not restart entrances on matching cards', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.locator('.filter-drawer summary').click();
  await page.waitForTimeout(800);
  const animatedCards = await page.evaluate(() => {
    const calls: string[] = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<typeof animate>) {
      // The physical-response pass permits outline accents, but cards must
      // still avoid individual entrance motion or a repeated stagger.
      const frames = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (
        this.matches('[data-project-card]') &&
        frames.some(
          (frame) =>
            frame &&
            ['transform', 'translate', 'opacity'].some((key) => key in frame),
        )
      )
        calls.push(this.id);
      return animate.apply(this, args);
    };
    document
      .querySelector<HTMLButtonElement>('[data-theme-filter="world"]')!
      .click();
    return calls;
  });
  expect(animatedCards).toEqual([]);
  await expect(page.locator('[data-theme-filter="world"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.locator('#project-results [data-project-card]:visible'),
  ).not.toHaveCount(0);
});

test('map preview is distinct from a committed selection', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Hover preview is a fine-pointer interaction.');
  await page.goto('/explore/?mode=map&room=ws10');
  const pin = page.locator('[data-room-plan="ws10"] [data-map-pin]').first();
  await pin.hover();
  await expect(page.locator('[data-exhibition-map]')).toHaveAttribute(
    'data-preview-mode',
    'hover',
  );
  await expect(pin).not.toHaveAttribute('aria-current', 'true');
  await expect(pin).toHaveAttribute('data-previewed', 'true');
  await expect(page).not.toHaveURL(/project=/);
  await pin.click();
  await expect(pin).toHaveAttribute('aria-current', 'true');
  await expect(pin).not.toHaveAttribute('data-previewed');
  await expect(
    page.locator('.atlas-selected-project [data-preview-state]'),
  ).toContainText('Selected');
  await expect(page).toHaveURL(/project=/);
});

test('locate preserves search and Back returns focus to the initiating project', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.locator('#search').fill('Qilin');
  const locate = page
    .locator('#project-results [data-locate-project]:visible')
    .first();
  const id = await locate.getAttribute('data-locate-project');
  await locate.click();
  await expect(page.locator('.atlas-selected-project')).toHaveAttribute(
    'data-atlas-project',
    id!,
  );
  await expect(page.locator('.atlas-selected-project h3')).toBeFocused();
  await page.goBack();
  await expect(page.locator('#search')).toHaveValue('Qilin');
  await expect(locate).toBeFocused();
  await page.goForward();
  await expect(page.locator('.atlas-selected-project')).toHaveAttribute(
    'data-atlas-project',
    id!,
  );
  await page.goBack();
  await expect(locate).toBeFocused();
});

test('a failed removal explains that the saved project remains', async ({
  page,
}) => {
  await page.goto('/explore/');
  const card = page.locator('#project-results [data-project-card]').first();
  const button = card.locator('[data-save]');
  await button.click();
  const stored = await page.evaluate((k) => localStorage.getItem(k), key);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
  });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('[data-save-notice]')).toContainText('still saved');
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(stored);
});

test('reduced motion keeps save and map outcomes without active feedback motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/explore/');
  const card = page.locator('#project-results [data-project-card]').first();
  await card.locator('[data-save]').click();
  await expect(card.locator('[data-save-notice]')).toHaveText(
    'Saved on this device.',
  );
  expect(
    await card
      .locator('[data-save]')
      .evaluate((el) => el.getAnimations().length),
  ).toBe(0);
  const locate = page.locator('#project-results [data-locate-project]').first();
  await locate.click();
  await expect(
    page.locator('.atlas-selected-project [data-preview-state]'),
  ).toContainText('Selected');
});

test('keyboard save, artwork return, shortlist removal and undo retain a usable focus', async ({
  page,
}) => {
  await page.goto('/explore/');
  const card = page.locator('#project-results [data-project-card]').first();
  const id = await card.getAttribute('data-id');
  const button = card.locator('[data-save]');
  await button.focus();
  await page.keyboard.press('Space');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await card.locator('[data-project-link]').first().click();
  const artwork = page.locator('[data-open-artwork]:visible').first();
  await expect(artwork).toBeVisible();
  await artwork.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('[data-artwork-viewer]');
  await expect(dialog).toBeVisible();
  await dialog.locator(`[data-artwork="${id}"] [data-save]`).click();
  await expect(
    dialog.locator(`[data-artwork="${id}"] [data-save-notice]`),
  ).toHaveText('Removed from My visit.');
  await expect(page.locator('#status')).toBeEmpty();
  await expect(dialog.locator('[data-viewer-feedback]')).toContainText(
    'removed',
  );
  await dialog.locator(`[data-artwork="${id}"] [data-save]`).click();
  await page.keyboard.press('Escape');
  await expect(artwork).toBeFocused();
  await page.goto('/my-visit/');
  await page.locator('[data-project-card]:visible [data-save]').first().focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-shortlist-undo]')).toBeVisible();
  await expect(page.locator('#shortlist-empty a')).toBeFocused();
  await page.locator('[data-undo-saved]').click();
  await expect(page.locator('[data-project-card]:visible')).toHaveCount(1);
  await expect(
    page.locator('[data-project-card]:visible [data-save]'),
  ).toBeFocused();
});

test('removing a saved-only result moves focus out of its hidden card', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.locator('#project-results [data-save]').first().click();
  await page.goto('/explore/?savedOnly=1');
  const button = page.locator(
    '#project-results [data-project-card]:visible [data-save]',
  );
  await button.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#no-results')).toBeVisible();
  await expect(page.locator('#result-count')).toBeFocused();
});
