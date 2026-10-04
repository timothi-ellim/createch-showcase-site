import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {
  qrAssets,
  generateSignage,
  verifySignage,
} from '../../editorial/signage.ts';
import { projectUrl, snapshotOrigin } from '../../src/lib/project-url.ts';
import { freezeSnapshot, readSnapshot } from '../../src/lib/content-schema.ts';
import { renderProjectBody } from '../../src/lib/project-renderer.ts';
test('QR output decodes every catalogue slug to the canonical destination with deterministic bytes', async () => {
  const catalogue = JSON.parse(await readFile('content/projects.json', 'utf8'));
  for (const project of catalogue.projects) {
    const url = projectUrl('https://createch-showcase.pages.dev', project.slug);
    const qr = await qrAssets(url),
      again = await qrAssets(url);
    assert.equal(qr.svg, again.svg);
    assert.ok(qr.png.equals(again.png));
    const raw = await sharp(qr.png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.ok(raw.info.width >= 1200);
    assert.equal(
      jsQR(new Uint8ClampedArray(raw.data), raw.info.width, raw.info.height)
        ?.data,
      url,
    );
  }
  for (const origin of [
    'https://createch-workspace.pages.dev',
    'https://abc.createch-showcase.pages.dev',
    'http://localhost:4321',
    'https://createch-showcase.pages.dev/?draft=1',
  ])
    assert.throws(() => projectUrl(origin, 'valid-slug'));
  assert.throws(() =>
    projectUrl('https://createch-showcase.pages.dev', '../bad'),
  );
});
test('historical snapshots retain their digest; approved hours require v2 and render without client replacement', async () => {
  const event = JSON.parse(await readFile('content/event.json', 'utf8')),
    catalogue = JSON.parse(await readFile('content/projects.json', 'utf8'));
  const old = freezeSnapshot({
    schemaVersion: 1,
    publicationStatus: 'synthetic-local-only',
    event,
    themes: catalogue.themes,
    projects: catalogue.projects,
  });
  assert.deepEqual(readSnapshot(JSON.parse(JSON.stringify(old))), old);
  const project = {
    ...old.projects[0],
    invigilationWindows: [{ start: '11:00', end: '12:00' }],
  };
  const { revision: legacyRevision, ...legacyPayload } = old;
  assert.throws(
    () => freezeSnapshot({ ...legacyPayload, projects: [project] }),
    /VALIDATION_FAILED/,
  );
  const snapshot = freezeSnapshot({
    schemaVersion: 2,
    publicationStatus: 'synthetic-local-only',
    event,
    themes: catalogue.themes,
    projects: [project],
  });
  const html = renderProjectBody(snapshot.projects[0], {
    eventDateLabel: event.dateLabel,
  });
  assert.ok(html.includes('Meet the artist'));
  assert.ok(html.includes('11:00–12:00'));
  assert.ok(
    html.indexOf('<aside') < html.indexOf('<div class="detail-reading">'),
  );
  assert.ok(!renderProjectBody(old.projects[0]).includes('Meet the artist'));
  assert.equal(snapshotOrigin(snapshot), 'https://createch-preview.invalid');
});

test('print and QR packs fail closed on stale files, tampering and private bytes, and retain a real card preview', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'createch-signage-'));
  try {
    const event = JSON.parse(await readFile('content/event.json', 'utf8')),
      catalogue = JSON.parse(await readFile('content/projects.json', 'utf8'));
    const snapshot = freezeSnapshot({
      schemaVersion: 2,
      publicationStatus: 'synthetic-local-only',
      event,
      themes: catalogue.themes,
      projects: [catalogue.projects[3]],
    });
    await generateSignage(directory, snapshot);
    await verifySignage(directory, snapshot, ['PRIVATE_SIGNAGE_CANARY']);
    const preview = await sharp(
      join(directory, 'generated/signage/sample-long-title.png'),
    ).metadata();
    assert.ok(preview.width! >= 390 && preview.height! >= 550);
    await assert.rejects(
      generateSignage(directory, snapshot),
      /SIGNAGE_OUTPUT_NOT_EMPTY/,
    );
    const indexPath = join(directory, 'generated/signage/catalogue.json'),
      index = JSON.parse(await readFile(indexPath, 'utf8'));
    const zipPath = 'generated/qr/project-qr-codes.zip',
      originalZip = await readFile(join(directory, zipPath));
    const wrongZip = zipSync({
      'wrong-project.svg': new Uint8Array([1, 2, 3]),
    });
    await writeFile(join(directory, zipPath), wrongZip);
    index.assets[zipPath] = createHash('sha256').update(wrongZip).digest('hex');
    await writeFile(indexPath, JSON.stringify(index));
    await assert.rejects(
      verifySignage(directory, snapshot),
      /QR_PACK_MISMATCH/,
    );
    await writeFile(join(directory, zipPath), originalZip);
    index.assets[zipPath] = createHash('sha256')
      .update(originalZip)
      .digest('hex');
    const pdfPath = 'generated/signage/project-cards.pdf',
      pdf = await readFile(join(directory, pdfPath));
    const badPdf = Buffer.concat([pdf, Buffer.from('PRIVATE_SIGNAGE_CANARY')]);
    await writeFile(join(directory, pdfPath), badPdf);
    index.assets[pdfPath] = createHash('sha256').update(badPdf).digest('hex');
    await writeFile(indexPath, JSON.stringify(index));
    await assert.rejects(
      verifySignage(directory, snapshot, ['PRIVATE_SIGNAGE_CANARY']),
      /PRIVATE_VALUE_IN_SIGNAGE/,
    );
    await writeFile(
      join(directory, 'generated/qr/withdrawn-project.svg'),
      'stale',
    );
    await assert.rejects(
      verifySignage(directory, snapshot),
      /UNEXPECTED_SIGNAGE_ASSET/,
    );
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes('createch-signage-'));
    await rm(directory, { recursive: true, force: true });
  }
});
