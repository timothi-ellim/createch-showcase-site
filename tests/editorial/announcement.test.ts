import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  freezeSnapshot,
  releaseBlockers,
} from '../../src/lib/content-schema.ts';

const event = JSON.parse(readFileSync('content/event.json', 'utf8'));
const { themes } = JSON.parse(readFileSync('content/projects.json', 'utf8'));
const announcement = () =>
  freezeSnapshot({
    schemaVersion: 1,
    publicationStatus: 'approved-public',
    event: {
      ...event,
      publicSiteUrl: 'https://createch-showcase.pages.dev/',
      programmeStatus: 'announcement',
    },
    themes,
    projects: [],
  });

test('an explicit roster announcement can launch while project approvals remain pending', () => {
  const snapshot = announcement();
  assert.equal(snapshot.event.participants.length, 13);
  assert(
    snapshot.event.participants.some(
      (person) => person.name === 'Savannah Irving',
    ),
  );
  assert.deepEqual(releaseBlockers(snapshot), []);
  assert.equal(snapshot.projects.length, 0);
});
test('ordinary empty catalogues, empty announcements and synthetic content remain blocked', () => {
  const snapshot = announcement();
  assert(
    releaseBlockers({
      ...snapshot,
      event: { ...snapshot.event, programmeStatus: 'projects' },
    }).length,
  );
  assert(
    releaseBlockers({
      ...snapshot,
      event: { ...snapshot.event, participants: [] },
    }).length,
  );
  assert(
    releaseBlockers({
      ...snapshot,
      publicationStatus: 'synthetic-local-only',
    }).includes('synthetic content'),
  );
});
test('a roster cannot carry private contact fields or duplicate assignments', () => {
  const snapshot = announcement();
  const { revision, ...payload } = snapshot;
  assert.throws(() =>
    freezeSnapshot({
      ...payload,
      event: {
        ...snapshot.event,
        participants: [
          {
            projectId: 'savannah-irving',
            name: 'Savannah Irving',
            email: 'private@example.invalid',
          },
        ],
      },
    }),
  );
  assert.throws(() =>
    freezeSnapshot({
      ...payload,
      event: {
        ...snapshot.event,
        participants: [
          snapshot.event.participants[0],
          snapshot.event.participants[0],
        ],
      },
    }),
  );
});
