import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  freezeSnapshot,
  releaseBlockers,
} from '../../src/lib/content-schema.ts';
import { fixture } from './helpers.ts';
import { renderProjectBody } from '../../src/lib/project-renderer.ts';

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

test('approved profiles can publish with explicitly unconfirmed practical details while approval and media gates remain', () => {
  const { revision: _, ...payload } = announcement();
  const project = {
    ...fixture,
    id: 'reviewed-profile',
    slug: 'reviewed-profile',
    maker: 'Review test maker',
    title: 'Review test work',
    approvedRevision: 'a'.repeat(64),
    room: null,
    schedule: null,
    duration: null,
    accessNotes: null,
    media: {
      src: `/media/${'b'.repeat(64)}.webp`,
      alt: 'Test artwork',
      credit: 'Test maker',
    },
    relatedIds: [],
  };
  const snapshot = freezeSnapshot({
    ...payload,
    event: { ...payload.event, programmeStatus: 'projects' },
    projects: [project],
  });
  assert.deepEqual(releaseBlockers(snapshot), []);
  const html = renderProjectBody(snapshot.projects[0]);
  assert.match(html, /Not confirmed/);
  assert.match(html, /Not yet supplied/);
  assert.throws(() =>
    freezeSnapshot({
      ...payload,
      projects: [{ ...project, approvedRevision: null }],
    }),
  );
  assert(
    releaseBlockers({
      ...snapshot,
      projects: [{ ...project, media: null }],
    }).includes('approved project media'),
  );
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
