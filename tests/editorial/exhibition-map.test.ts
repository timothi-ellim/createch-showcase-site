import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapPreviewEnabled,
  placedProjects,
  proposedPlacements,
} from '../../src/lib/exhibition-map.ts';
import { readShortlist } from '../../src/lib/shortlist.ts';
import type { PublicProject } from '../../src/lib/content-schema.ts';

test('the authorised atlas requires an approved public catalogue in production', () => {
  for (const mode of [
    'production',
    'development',
    'fixture-preview',
    'editorial-preview',
  ])
    assert.equal(mapPreviewEnabled(mode), false);
  assert.equal(mapPreviewEnabled('exhibition-preview'), true);
  assert.equal(mapPreviewEnabled('production', 'approved-public'), true);
  assert.equal(mapPreviewEnabled('production', 'synthetic-local-only'), false);
  assert.equal(
    mapPreviewEnabled('editorial-preview', 'approved-public'),
    false,
  );
});
test('only public project IDs can join a location; renaming never transfers it', () => {
  const projects = [
    { id: 'listen-scoundrels', maker: 'Changed public name' },
    { id: 'different-project', maker: 'Sean Carroll' },
  ] as PublicProject[];
  assert.deepEqual(
    placedProjects(projects).map((row) => row.projectId),
    ['listen-scoundrels'],
  );
  assert.deepEqual(placedProjects([]), []);
  assert.equal(
    new Set(proposedPlacements.map((row) => row.projectId)).size,
    proposedPlacements.length,
  );
  assert.equal(
    new Set(proposedPlacements.map((row) => row.marker)).size,
    proposedPlacements.length,
  );
});
test('shortlist distinguishes missing, corrupt and inaccessible storage', () => {
  assert.equal(readShortlist({ getItem: () => null }).saved.size, 0);
  assert.deepEqual(
    [...readShortlist({ getItem: () => '["one","one"]' }).saved],
    ['one'],
  );
  assert.match(
    readShortlist({ getItem: () => '{broken' }).notice,
    /could not be read/,
  );
  const denied = readShortlist({
    getItem: () => {
      throw new Error('denied');
    },
  });
  assert.equal(denied.available, false);
  assert.equal(denied.saved.size, 0);
});
