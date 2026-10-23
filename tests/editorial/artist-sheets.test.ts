import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pack from '../../src/data/artist-sheets.json' with { type: 'json' };
import { artistInformationSheet } from '../../src/lib/artist-sheets.ts';
import { verifyArtistSheetFiles } from '../../editorial/artist-sheets.ts';
import { renderProjectBody } from '../../src/lib/project-renderer.ts';
import { fixture } from './helpers.ts';

test('print links require the exact approved edition, project and revision', () => {
  const snapshot = { publicationStatus: 'approved-public' as const, revision: pack.sourceRevision };
  const sheet = pack.sheets[0];
  assert.equal(artistInformationSheet(snapshot, sheet), sheet.path);
  assert.equal(artistInformationSheet({ ...snapshot, revision: '0'.repeat(64) }, sheet), undefined);
  assert.equal(artistInformationSheet({ ...snapshot, publicationStatus: 'synthetic-local-only' }, sheet), undefined);
  assert.equal(artistInformationSheet(snapshot, { ...sheet, approvedRevision: '0'.repeat(64) }), undefined);
  assert.equal(artistInformationSheet(snapshot, { ...sheet, slug: 'other-project' }), undefined);
});

test('reviewed PDFs must exist and match their complete byte hashes', async () => {
  await verifyArtistSheetFiles('public');
  const dir = await mkdtemp(join(tmpdir(), 'createch-print-'));
  try {
    await cp('public/guides/artist-sheets', join(dir, 'guides/artist-sheets'), { recursive: true });
    await writeFile(join(dir, pack.sheets[0].path.slice(1)), '%PDF-corrupt');
    await assert.rejects(verifyArtistSheetFiles(dir), /does not match reviewed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('A4 download is a plain link with print guidance and stays out of private previews', () => {
  const options = { informationSheetPath: pack.sheets[0].path };
  const html = renderProjectBody(fixture, options);
  assert.ok(html.includes(`href="${options.informationSheetPath}" download>Download A4 information sheet</a>`));
  assert.ok(html.includes('Print at 100% / Actual size'));
  assert.ok(!renderProjectBody(fixture, { ...options, privatePreview: true }).includes('Download A4'));
});
