import { test, expect } from '@playwright/test';

test('homepage sculpture controls connect to the shared response and still change shape', async ({ page }) => {
  await page.goto('/');
  const wave = page.locator('[data-sketch-shape="1"]');
  await wave.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await wave.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(wave).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => { const detail:{state?:{pulses:unknown[]}}={};document.dispatchEvent(new CustomEvent('createch:flow-capture',{detail}));return detail.state?.pulses.length??0; })).toBeGreaterThan(0);
});

test('a recoiling neighbour becomes stationary as soon as it is targeted', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Fine-pointer transfer.');
  await page.goto('/explore/');
  await page.locator('.filter-drawer summary').click();
  await page.waitForTimeout(900);
  const motions = await page.evaluate(() => {
    const first = document.querySelector('[data-theme-filter="all"]')!;
    const next = document.querySelector('[data-theme-filter="world"]')!;
    first.dispatchEvent(
      new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
    );
    const before = next
      .getAnimations()
      .filter((a) => a.id === 'physical-neighbour').length;
    next.dispatchEvent(
      new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
    );
    return {
      before,
      after: next.getAnimations().filter((a) => a.id === 'physical-neighbour')
        .length,
    };
  });
  expect(motions.before).toBeGreaterThan(0);
  expect(motions.after).toBe(0);
});

test('hover connects nearby controls to the page surface without moving the hovered target', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Hover requires a fine pointer.');
  await page.goto('/explore/');
  await page.locator('.filter-drawer summary').click();
  const button = page.locator('[data-theme-filter="all"]');
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  const before = await button.boundingBox();
  await button.hover();
  await expect(button).toHaveAttribute('data-physical-hover', '');
  await expect(page.locator('.physical-field')).toHaveAttribute(
    'data-active',
    '',
  );
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id === 'physical-neighbour')
          .length,
    ),
  ).toBeGreaterThan(0);
  const after = await button.boundingBox();
  expect(after?.x).toBe(before?.x);
  expect(after?.y).toBe(before?.y);
  await page.mouse.move(5, 800);
  await page.waitForTimeout(800);
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id.startsWith('physical-'))
          .length,
    ),
  ).toBe(0);
});

test('press, ripple and nearby recoil stay bounded and preserve the real filter action', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.locator('.filter-drawer summary').click();
  const button = page.locator('[data-theme-filter="world"]');
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await button.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => { const detail:{state?:{pulses:unknown[]}}={};document.dispatchEvent(new CustomEvent('createch:flow-capture',{detail}));return detail.state?.pulses.length??0; })).toBeGreaterThan(0);
  await page.locator('[data-theme-filter="all"]').evaluate((el) => {
    for (let i = 0; i < 8; i++) (el as HTMLButtonElement).click();
  });
  expect(await page.evaluate(() => { const detail:{state?:{pulses:unknown[]}}={};document.dispatchEvent(new CustomEvent('createch:flow-capture',{detail}));return detail.state?.pulses.length??0; })).toBeLessThanOrEqual(4);
  await page.waitForTimeout(1200);
  await expect(page.locator('.physical-wave')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id.startsWith('physical-'))
          .length,
    ),
  ).toBe(0);
});

test('reduced motion and the site pause control stop the connected response', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.locator('.filter-drawer summary').click();
  await page.locator('[data-theme-filter="world"]').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.physical-wave')).toHaveCount(0);
  await page.locator('[data-theme-filter="all"]').click();
  await expect(page.locator('[data-theme-filter="all"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.id.startsWith('physical-'))
          .length,
    ),
  ).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('[data-motion-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-loop-motion',
    'paused',
  );
  await page.locator('[data-theme-filter="world"]').click();
  await expect(page.locator('.physical-wave')).toHaveCount(0);
});

test('keyboard focus stays stationary and cancelling a touch press clears depth', async ({
  page,
}) => {
  await page.goto('/explore/');
  await page.locator('.filter-drawer summary').click();
  const button = page.locator('[data-theme-filter="world"]');
  await button.focus();
  await page.keyboard.press('Space');
  await expect(button).toBeFocused();
  expect(await button.evaluate((el) => getComputedStyle(el).translate)).toBe(
    'none',
  );
  await button.dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    button: 0,
  });
  await expect(button).toHaveAttribute('data-physical-down', '');
  await button.dispatchEvent('pointercancel', {
    pointerId: 7,
    pointerType: 'touch',
  });
  await expect(button).not.toHaveAttribute('data-physical-down');
});

test('reading pages and homepage share the response without changing their text', async ({
  page,
}) => {
  for (const route of ['/', '/visit/', '/about/', '/my-visit/']) {
    await page.goto(route);
    await expect(page.locator('body')).toHaveAttribute(
      'data-physical-ready',
      '',
    );
    await expect(page.locator('.physical-field')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(
      await page.locator('.physical-section-rule').count(),
    ).toBeGreaterThan(0);
    const before = await page.locator('main').innerText();
    await page.evaluate(() => scrollTo(0, 500));
    await page.waitForTimeout(800);
    expect(await page.locator('main').innerText()).toBe(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
});
