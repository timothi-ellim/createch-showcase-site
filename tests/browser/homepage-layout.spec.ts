import { test, expect } from '@playwright/test';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`homepage introduction stays in flow with ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    for (const width of [320, 390, 768, 899, 900, 901, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const intro = page.locator('.event-overview-heading');
      await intro.scrollIntoViewIfNeeded();
      for (const larger of [false, true]) {
        const size = page.getByRole('button', { name: 'Larger text' });
        if (larger) await size.click();
        await expect(size).toHaveAttribute('aria-pressed', String(larger));
        await expect
          .poll(async () =>
            page.evaluate(() => {
              const heading = document
                .querySelector('.event-overview-heading')!
                .getBoundingClientRect();
              const toolbar = document
                .querySelector('.reading-toolbar')!
                .getBoundingClientRect();
              const first = document
                .querySelector('.reading-passage')!
                .getBoundingClientRect();
              return {
                overflow: document.documentElement.scrollWidth > innerWidth,
                headingOverlap:
                  innerWidth <= 900 && heading.bottom + 24 > toolbar.top,
                passageOverlap: toolbar.bottom > first.top + 1,
              };
            }),
          )
          .toEqual({
            overflow: false,
            headingOverlap: false,
            passageOverlap: false,
          });
      }
    }
  });
}

test('project image links exclude credits and projects precede the poster', async ({
  page,
}) => {
  await page.goto('/');
  const cards = page.locator('.featured-grid [data-project-card]');
  for (const card of await cards.all()) {
    await expect(card.locator('[data-project-media-link]')).toHaveCount(1);
    expect(
      await card
        .locator('figcaption')
        .evaluateAll((captions) =>
          captions.every((caption) => !caption.closest('a')),
        ),
    ).toBe(true);
  }
  expect(
    await page
      .locator('.home-projects')
      .evaluate((projects) =>
        Boolean(
          projects.compareDocumentPosition(document.querySelector('#poster')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  ).toBe(true);
  await expect(page.locator('.hero .actions a')).toHaveCount(2);
});

test('section dividers have their own space above the introduction', async ({
  page,
}) => {
  await page.goto('/');
  for (const width of [320, 900, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const heading = page.locator('.home-projects .section-heading');
    await heading.scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        heading.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const rule = getComputedStyle(element, '::after');
          const ruleBottom = bounds.bottom - parseFloat(rule.bottom);
          const ruleTop = ruleBottom - parseFloat(rule.height);
          const textBottom = Math.max(
            ...Array.from(element.querySelectorAll('h2, a')).map(
              (node) => node.getBoundingClientRect().bottom,
            ),
          );
          return (
            ruleTop >= textBottom + 8 &&
            ruleBottom <=
              element.nextElementSibling!.getBoundingClientRect().top + 1
          );
        }),
      )
      .toBe(true);
  }
});
