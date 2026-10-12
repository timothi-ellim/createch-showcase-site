import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';
import { event, themes, fixture } from './helpers.ts';
import { freezeSnapshot } from '../../src/lib/content-schema.ts';
import { sharingPack, sharingFormats, sharingCopy } from '../../src/lib/sharing-pack.ts';

test('downloadable pack contains usable graphics, current event facts and exact participant names and titles', async () => {
  const snapshot = freezeSnapshot({
    schemaVersion: 1,
    publicationStatus: 'synthetic-local-only',
    event: { ...event, publicSiteUrl: 'https://sharing.example.invalid/' },
    themes,
    projects: [{ ...fixture, title: 'A & B, "C"', maker: 'A, "B"' }],
  });
  const before = JSON.stringify(snapshot);
  const entries = unzipSync(await sharingPack(snapshot));
  assert.equal(Object.keys(entries).length, 8);
  for (const format of sharingFormats) {
    const image = await sharp(entries[`createch-${format.id}.png`]).metadata();
    assert.equal(image.format, 'png');
    assert.equal(image.width, format.width);
    assert.equal(image.height, format.height);
    assert.equal(image.exif, undefined);
  }
  const copy = sharingCopy(snapshot.event);
  for (const [name, text] of [['invitation.txt', copy.invitation], ['social-caption.txt', copy.caption], ['event-listing.txt', copy.listing]]) {
    assert.equal(strFromU8(entries[name]), text + '\n');
    assert.ok(text.includes(event.dateLabel));
    assert.ok(text.includes('11:00–16:00 (UK time)'));
    assert.ok(text.includes('https://sharing.example.invalid/'));
  }
  assert.equal(strFromU8(entries['project-links.csv']), `Participant,Project,Link\r\n"A, ""B""","A & B, ""C""","https://sharing.example.invalid/projects/${fixture.slug}/"\r\n`);
  assert.equal(JSON.stringify(snapshot), before, 'Generating a pack must not mutate approved content.');
});
