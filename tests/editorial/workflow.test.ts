import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  bindResponse,
  ingest,
  approve,
  exportApproved,
  withdraw,
  updateOrganiserFields,
  selectPreviousApproval,
  splitProject,
} from '../../editorial/workflow.ts';
import {
  profileSchema,
  freezeSnapshot,
  readSnapshot,
  releaseBlockers,
  validate,
  ContentError,
} from '../../src/lib/content-schema.ts';
import {
  setup,
  fixture,
  secondFixture,
  event,
  themes,
  timestamp,
} from './helpers.ts';

test('response binding cannot be duplicated or reassigned', () => {
  const { state, organiser } = setup();
  assert.throws(
    () =>
      bindResponse(state, {
        organiser,
        ownerContact: 'other@example.invalid',
        formId: 'other-form',
        responseId: 'other-response',
      }),
    /BINDING_ALREADY_EXISTS/,
  );
  assert.throws(
    () =>
      bindResponse(state, {
        organiser: {
          ...organiser,
          id: 'different-project',
          slug: 'different-project',
        },
        ownerContact: 'other@example.invalid',
        formId: 'test-private-form-100',
        responseId: 'test-private-response-100',
      }),
    /BINDING_ALREADY_EXISTS/,
  );
});
test('name changes remain on the mapped project; user-editable identity is rejected', () => {
  const { state, response, profile } = setup();
  ingest(state, {
    ...response,
    observedAt: timestamp(2),
    lastSubmittedAt: timestamp(2),
    profile: {
      ...profile,
      title: 'Synthetic changed title',
      maker: 'Synthetic changed maker',
    },
  });
  assert.equal(state.records[fixture.id].draft!.candidate!.id, fixture.id);
  ingest(state, {
    ...response,
    observedAt: timestamp(3),
    lastSubmittedAt: timestamp(3),
    profile: { ...profile, id: secondFixture.id, room: 'Invented room' },
  });
  assert.ok(
    state.records[fixture.id].draft!.errors.includes('VALIDATION_FAILED'),
  );
  assert.equal(state.records[secondFixture.id], undefined);
});
test('unknown responses are quarantined once, never assigned by submitted names', () => {
  const { state, response } = setup();
  const incoming = { ...response, responseId: 'unmapped-response' };
  assert.equal(ingest(state, incoming).outcome, 'quarantined');
  ingest(state, incoming);
  assert.equal(state.quarantined.length, 1);
  assert.equal(Object.keys(state.records).length, 1);
});
test('repeated intake is idempotent and old responses cannot revert newer drafts', () => {
  const { state, response, profile } = setup();
  assert.equal(ingest(state, response).outcome, 'unchanged');
  ingest(state, {
    ...response,
    observedAt: timestamp(3),
    lastSubmittedAt: timestamp(3),
    profile: { ...profile, invitation: 'Synthetic new invitation' },
  });
  assert.equal(ingest(state, response).outcome, 'stale-observation');
  assert.equal(
    ingest(state, { ...response, observedAt: timestamp(4) }).outcome,
    'stale-response',
  );
  assert.equal(state.records[fixture.id].draft!.revision, 2);
});
test('edited answers with unchanged provider timestamp are caught by later reconciliation', () => {
  const { state, response, profile } = setup();
  ingest(state, {
    ...response,
    observedAt: timestamp(4),
    profile: {
      ...profile,
      invitation: 'Synthetic edit discovered through reconciliation.',
    },
  });
  assert.equal(state.records[fixture.id].draft!.revision, 2);
});
test('exact approval preserves the previous approved page when newer drafts arrive', () => {
  const { state, response, profile } = setup();
  const hash = state.records[fixture.id].draft!.hash;
  approve(state, fixture.id, hash, 'Synthetic organiser');
  const before = exportApproved(state);
  ingest(state, {
    ...response,
    observedAt: timestamp(2),
    lastSubmittedAt: timestamp(2),
    profile: { ...profile, invitation: 'Synthetic pending edit' },
  });
  assert.deepEqual(exportApproved(state), before);
  assert.throws(
    () => approve(state, fixture.id, hash, 'Synthetic organiser'),
    /STALE_APPROVAL/,
  );
  approve(
    state,
    fixture.id,
    state.records[fixture.id].draft!.hash,
    'Synthetic organiser',
  );
  assert.notEqual(exportApproved(state).revision, before.revision);
  assert.equal(
    state.records[fixture.id].approvals[0].project.invitation,
    profile.invitation,
  );
});
test('organiser-owned fields create a new draft without silently updating approval', () => {
  const { state, organiser } = setup();
  approve(
    state,
    fixture.id,
    state.records[fixture.id].draft!.hash,
    'Synthetic organiser',
  );
  const before = exportApproved(state);
  updateOrganiserFields(state, fixture.id, { ...organiser, theme: 'relation' });
  assert.deepEqual(exportApproved(state), before);
  assert.equal(state.records[fixture.id].draft!.candidate!.theme, 'relation');
  assert.throws(
    () =>
      updateOrganiserFields(state, fixture.id, {
        ...organiser,
        id: 'changed-id',
      }),
    /STABLE_IDENTITY_CANNOT_CHANGE/,
  );
});
test('strict profile validation rejects markup, private links, unsafe URLs and extra fields', () => {
  const { profile } = setup();
  for (const patch of [
    { title: '<script>alert(1)</script>' },
    { invitation: 'https://docs.google.com/forms/?edit2=private-test' },
    { links: [{ label: 'Unsafe', url: 'javascript:alert(1)' }] },
    { links: [{ label: 'Secret', url: 'https://example.com/?token=hidden' }] },
    { responseId: 'private' },
    {
      media: {
        src: 'https://example.com/unreviewed.jpg',
        alt: 'Example',
        credit: 'Unknown',
      },
    },
    { title: '' },
  ]) {
    assert.throws(
      () => validate(profileSchema, { ...profile, ...patch }),
      ContentError,
    );
  }
});
test('private contact/response values cannot leak through otherwise valid public text', () => {
  const { state, response, profile } = setup();
  ingest(state, {
    ...response,
    observedAt: timestamp(2),
    lastSubmittedAt: timestamp(2),
    profile: {
      ...profile,
      description: 'Write to synthetic-private@example.invalid',
    },
  });
  assert.deepEqual(state.records[fixture.id].draft!.errors, [
    'PRIVATE_VALUE_IN_PUBLIC_CONTENT',
  ]);
  assert.throws(
    () =>
      approve(
        state,
        fixture.id,
        state.records[fixture.id].draft!.hash,
        'Synthetic organiser',
      ),
    /NO_VALID_DRAFT/,
  );
});
test('unknown media cannot be approved just because a participant supplied a path', () => {
  const { state, response, profile } = setup();
  ingest(state, {
    ...response,
    observedAt: timestamp(2),
    lastSubmittedAt: timestamp(2),
    profile: {
      ...profile,
      media: {
        src: `/media/${'a'.repeat(64)}.webp`,
        alt: 'Synthetic image',
        credit: 'Synthetic credit',
      },
    },
  });
  assert.throws(
    () =>
      approve(
        state,
        fixture.id,
        state.records[fixture.id].draft!.hash,
        'Synthetic organiser',
      ),
    /MEDIA_NOT_APPROVED/,
  );
});
test('approval tampering blocks export; public snapshots are self-verifying', () => {
  const { state } = setup();
  approve(
    state,
    fixture.id,
    state.records[fixture.id].draft!.hash,
    'Synthetic organiser',
  );
  const snapshot = exportApproved(state);
  assert.deepEqual(readSnapshot(snapshot), snapshot);
  assert.throws(
    () =>
      readSnapshot({
        ...snapshot,
        event: { ...snapshot.event, title: 'Different event title' },
      }),
    /SNAPSHOT_HASH_MISMATCH/,
  );
  state.records[fixture.id].approvals[0].project.title = 'Tampered title';
  assert.throws(() => exportApproved(state), /APPROVAL_HASH_MISMATCH/);
});
test('withdrawal and prior approval selection are explicit and reversible', () => {
  const { state } = setup();
  const hash = state.records[fixture.id].draft!.hash;
  approve(state, fixture.id, hash, 'Synthetic organiser');
  withdraw(state, fixture.id, hash);
  assert.equal(exportApproved(state).projects.length, 0);
  selectPreviousApproval(state, fixture.id, hash);
  assert.equal(exportApproved(state).projects.length, 1);
});
test('withdrawal does not mutate an immutable related-project approval', () => {
  const { state, organiser } = setup();
  const second = splitProject(secondFixture);
  bindResponse(state, {
    organiser: second.organiser,
    ownerContact: 'synthetic-2@example.invalid',
    formId: 'second-form',
    responseId: 'second-response',
  });
  ingest(state, {
    formId: 'second-form',
    responseId: 'second-response',
    observedAt: timestamp(1),
    lastSubmittedAt: timestamp(0),
    profile: second.profile,
  });
  updateOrganiserFields(state, fixture.id, {
    ...organiser,
    relatedIds: [secondFixture.id],
  });
  for (const record of Object.values(state.records))
    approve(
      state,
      record.organiser.id,
      record.draft!.hash,
      'Synthetic organiser',
    );
  const firstHash = state.records[fixture.id].selectedApproval;
  withdraw(
    state,
    secondFixture.id,
    state.records[secondFixture.id].selectedApproval!,
  );
  assert.equal(exportApproved(state).projects[0].approvedRevision, firstHash);
});
test('release requirements reject fixtures and inconsistent event dates', () => {
  const { state } = setup();
  assert.ok(
    releaseBlockers(exportApproved(state)).includes('synthetic content'),
  );
  assert.throws(
    () =>
      createState({ ...event, dateLabel: 'Wednesday 1 January 2026' }, themes),
    /VALIDATION_FAILED/,
  );
  assert.throws(
    () =>
      freezeSnapshot({
        schemaVersion: 1,
        publicationStatus: 'approved-public',
        event,
        themes,
        projects: [fixture],
      }),
    /VALIDATION_FAILED/,
  );
});
