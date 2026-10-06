import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { event, themes, fixture } from './helpers.ts';
import { freezeSnapshot, readSnapshot } from '../../src/lib/content-schema.ts';
import {
  eventDateTime,
  eventStructuredData,
  jsonLd,
} from '../../src/lib/discovery.ts';
import { socialImage } from '../../src/lib/social-image.ts';
import { runAstroBuild } from '../../editorial/publisher.ts';

test('event copy keeps historical snapshots readable and uses London offsets, without invented ticket or access claims', () => {
  const { description: _, shortDescription: __, ...legacyEvent } = event;
  const legacy = freezeSnapshot({
    schemaVersion: 1,
    publicationStatus: 'synthetic-local-only',
    event: legacyEvent,
    themes,
    projects: [],
  });
  assert.equal(readSnapshot(legacy).revision, legacy.revision);
  assert.equal(Object.hasOwn(legacy.event, 'description'), false);
  assert.equal(eventDateTime(event, '11:00'), '2026-10-28T11:00:00+00:00');
  assert.equal(
    eventDateTime({ ...event, date: '2026-07-28' }, '11:00'),
    '2026-07-28T11:00:00+01:00',
  );
  const data = eventStructuredData({
    ...event,
    publicSiteUrl: 'https://discovery.example.invalid/',
  })!;
  assert.equal(data.description, event.description);
  assert.equal(data.location.address.postalCode, 'LE1 6RN');
  for (const key of ['offers', 'isAccessibleForFree', 'performer', 'organizer'])
    assert.equal(Object.hasOwn(data, key), false);
  assert.ok(!jsonLd({ text: '</script><script>bad</script>' }).includes('<'));
});

test('sharing cards are PNGs at the declared dimensions, including long and XML-sensitive public text', async () => {
  for (const project of [
    undefined,
    {
      ...fixture,
      title: 'A & B "C" '.repeat(24),
      maker: 'A very long public name '.repeat(6),
    },
  ]) {
    const bytes = await socialImage(event, project);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 630);
    assert.equal(metadata.exif, undefined);
  }
});

test(
  'production-mode discovery output is static, canonical, crawlable and shareable; private/utility pages stay noindex',
  { timeout: 120000 },
  async () => {
    // Isolated local test receipt for a reserved .invalid origin; never deployed.
    const directory = resolve(
      '.build-candidates',
      `discovery-test-${randomUUID()}`,
    );
    const site = join(directory, 'site');
    await mkdir(directory, { recursive: true });
    const snapshot = freezeSnapshot({
      schemaVersion: 1,
      publicationStatus: 'approved-public',
      event: {
        ...event,
        programmeStatus: 'announcement',
        publicSiteUrl: 'https://discovery.example.invalid/',
        participants: [{ projectId: 'metadata-test', name: 'Metadata test' }],
      },
      themes,
      projects: [],
    });
    const input = join(directory, 'snapshot.json'),
      receipt = join(directory, 'local-test-receipt.json');
    await writeFile(input, JSON.stringify(snapshot));
    await writeFile(
      receipt,
      JSON.stringify({
        snapshotRevision: snapshot.revision,
        authorised: true,
        approvedBy: 'LOCAL AUTOMATED TEST ONLY',
        approvedAt: new Date().toISOString(),
      }),
    );
    await runAstroBuild(input, site, 'production', receipt);
    const home = await readFile(join(site, 'index.html'), 'utf8');
    assert.match(
      home,
      /rel="canonical" href="https:\/\/discovery\.example\.invalid\/"/,
    );
    assert.match(
      home,
      /name="robots" content="index, follow, max-image-preview:large"/,
    );
    assert.match(
      home,
      /property="og:image" content="https:\/\/discovery\.example\.invalid\/social\/where-code-becomes-culture-fac3d7b8\.jpg"/,
    );
    assert.match(home, /property="og:image:type" content="image\/jpeg"/);
    assert.match(
      home,
      /property="og:image:secure_url" content="https:\/\/discovery\.example\.invalid\/social\/where-code-becomes-culture-fac3d7b8\.jpg"/,
    );
    assert.match(
      home,
      /name="twitter:image" content="https:\/\/discovery\.example\.invalid\/social\/where-code-becomes-culture-fac3d7b8\.jpg"/,
    );
    assert.match(home, /name="twitter:card" content="summary_large_image"/);
    const structured = JSON.parse(
      home.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
      )![1],
    );
    assert.equal(structured.startDate, '2026-10-28T11:00:00+00:00');
    assert.equal(structured.endDate, '2026-10-28T16:00:00+00:00');
    assert.equal(structured.description, event.description);
    assert.match(home, /research beyond the page/i);
    assert.match(home, /mailto:\?subject=/);
    for (const destination of [
      'wa.me/',
      'www.facebook.com/sharer/sharer.php',
      'www.linkedin.com/sharing/share-offsite/',
    ])
      assert.ok(home.includes(destination));
    const descriptions = new Set<string>();
    for (const path of ['', 'about/', 'explore/', 'visit/', 'programme/']) {
      const html = await readFile(join(site, path, 'index.html'), 'utf8');
      assert.doesNotMatch(html, /noindex/);
      descriptions.add(html.match(/name="description" content="([^"]+)"/)![1]);
      if (path) assert.doesNotMatch(html, /application\/ld\+json/);
    }
    assert.equal(descriptions.size, 5);
    for (const path of ['my-visit/index.html', '404.html']) {
      assert.match(
        await readFile(join(site, path), 'utf8'),
        /noindex, nofollow/,
      );
    }
    const headers = await readFile(join(site, '_headers'), 'utf8');
    assert.match(
      headers,
      /\/participant\/\*[\s\S]*X-Robots-Tag: noindex, nofollow/,
    );
    assert.match(
      headers,
      /\/organiser\/\*[\s\S]*X-Robots-Tag: noindex, nofollow/,
    );
    const robots = await readFile(join(site, 'robots.txt'), 'utf8');
    assert.match(
      robots,
      /Allow: \/\nSitemap: https:\/\/discovery\.example\.invalid\/sitemap.xml/,
    );
    const sitemap = await readFile(join(site, 'sitemap.xml'), 'utf8');
    for (const path of ['about', 'explore', 'visit', 'programme'])
      assert.ok(sitemap.includes(`https://discovery.example.invalid/${path}/`));
    assert.doesNotMatch(
      sitemap,
      /my-visit|participant|organiser|404|localhost/,
    );
    assert.deepEqual(structured.image, [
      'https://discovery.example.invalid/social/where-code-becomes-culture-fac3d7b8.jpg',
    ]);
    const banner = await readFile(
      join(site, 'social/where-code-becomes-culture-fac3d7b8.jpg'),
    );
    const image = await sharp(banner).metadata();
    assert.equal(image.format, 'jpeg');
    assert.ok(
      banner.length < 300_000,
      'The social banner must stay small for preview fetches.',
    );
    assert.equal(image.exif, undefined);
    assert.equal(image.width, 1200);
    assert.equal(image.height, 630);
  },
);
