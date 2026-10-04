import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, asUser, rpc, A, O, PA, fields } from './database-harness.ts';
import {
  preparePortalRevision,
  snapshotFromManifest,
} from '../../editorial/portal-validator.ts';
async function approvedProfile(db: any) {
  await asUser(db, A);
  await rpc(db, 'save_project_draft', [PA, 0, fields]);
  const sub = await rpc<any>(db, 'submit_project_revision', [
    PA,
    1,
    randomUUID(),
  ]);
  await asUser(db, null, 'service_role');
  const job = await rpc<any>(db, 'worker_claim', [sub.jobId, 'presence-test']);
  const prepared = await preparePortalRevision(
    await rpc(db, 'worker_subject', [job.jobId, job.attemptId]),
    async () => {
      throw new Error('no image');
    },
  );
  await rpc(db, 'worker_prepare', [
    job.jobId,
    job.attemptId,
    prepared.snapshot,
    prepared.digest,
    [],
    'a'.repeat(40),
  ]);
  await asUser(db, O, 'authenticated', 'aal2');
  await rpc(db, 'decide_revision', [
    sub.revisionId,
    prepared.digest,
    0,
    'approved',
    '',
    '',
  ]);
  return { sub, prepared };
}
async function approvedHours(db: any) {
  await asUser(db, A);
  await rpc(db, 'save_presence_draft', [
    PA,
    0,
    1,
    { mode: 'selected_slots', slots: [0, 1, 6, 7] },
  ]);
  const sub = await rpc<any>(db, 'submit_presence', [PA, 1, randomUUID()]);
  await asUser(db, O, 'authenticated', 'aal2');
  await rpc(db, 'decide_presence', [
    sub.revisionId,
    sub.digest,
    0,
    'approved',
    null,
    '',
    '',
    'PRIVATE_PRESENCE_NOTE',
    false,
    randomUUID(),
  ]);
  return sub;
}
async function activate(db: any, release: any) {
  const jobId = await rpc<string>(db, 'approve_and_queue_release', [
    release.releaseId,
    release.digest,
  ]);
  await asUser(db, null, 'service_role');
  const job = await rpc<any>(db, 'worker_claim', [jobId, 'presence-live-test']);
  await rpc(db, 'worker_record_deployment', [jobId, job.attemptId, {}]);
  await rpc(db, 'worker_verified', [
    jobId,
    job.attemptId,
    release.digest,
    {
      verified: true,
      origin: null,
      contentRevision: snapshotFromManifest(release.manifest).revision,
    },
  ]);
  await asUser(db, O, 'authenticated', 'aal2');
}
test('hours-only release preserves profile approval, carries live hours during edits, and requires explicit removal', async () => {
  // Hosted installation already has publication-settings and organiser-text migrations.
  const db = await database('presence-last');
  try {
    const { sub, prepared } = await approvedProfile(db);
    await approvedHours(db);
    const state = await rpc<any>(db, 'get_presence', [PA]);
    assert.equal(
      (await rpc<any>(db, 'get_project_signage', [PA])).status,
      'unpublished',
    );
    const release = await rpc<any>(db, 'prepare_presence_release', [
      'a'.repeat(40),
      [sub.revisionId],
      [{ projectId: PA, decisionId: state.approved.id }],
    ]);
    const snapshot = snapshotFromManifest(release.manifest);
    assert.equal(snapshot.schemaVersion, 2);
    assert.equal(snapshot.projects[0].approvedRevision, prepared.digest);
    assert.deepEqual(snapshot.projects[0].invigilationWindows, [
      { start: '11:00', end: '12:00' },
      { start: '14:00', end: '15:00' },
    ]);
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_PRESENCE_NOTE'));
    const forged = structuredClone(release.manifest);
    forged.projects[0].presence.windows[0].start = '10:00';
    assert.throws(
      () => snapshotFromManifest(forged),
      /INVALID_PRESENCE_BINDING/,
    );
    await activate(db, release);
    await asUser(db, A);
    await rpc(db, 'save_presence_draft', [
      PA,
      1,
      1,
      { mode: 'not_attending', slots: [] },
    ]);
    const pending = await rpc<any>(db, 'submit_presence', [
      PA,
      2,
      randomUUID(),
    ]);
    const current = await rpc<any>(db, 'get_presence', [PA]);
    assert.equal(current.live.windows.length, 2);
    assert.equal(current.latest.decision, null);
    assert.equal(
      (await rpc<any>(db, 'get_project_signage', [PA])).status,
      'available',
    );
    await asUser(db, O, 'authenticated', 'aal2');
    const carried = await rpc<any>(db, 'prepare_release', [
      'a'.repeat(40),
      [sub.revisionId],
    ]);
    assert.deepEqual(
      snapshotFromManifest(carried.manifest).projects[0].invigilationWindows,
      snapshot.projects[0].invigilationWindows,
    );
    await assert.rejects(
      rpc(db, 'prepare_presence_release', [
        'a'.repeat(40),
        [sub.revisionId],
        [{ projectId: PA, decisionId: null }],
      ]),
      /PRESENCE_SELECTION_REQUIRED/,
    );
    await rpc(db, 'decide_presence', [
      pending.revisionId,
      pending.digest,
      1,
      'removed',
      null,
      '',
      'Participant no longer attending',
      '',
      false,
      randomUUID(),
    ]);
    const removed = await rpc<any>(db, 'get_presence', [PA]);
    const removal = await rpc<any>(db, 'prepare_presence_release', [
      'a'.repeat(40),
      [sub.revisionId],
      [{ projectId: PA, decisionId: removed.approved.id }],
    ]);
    assert.equal(
      snapshotFromManifest(removal.manifest).projects[0].invigilationWindows,
      undefined,
    );
    assert.equal(
      (await rpc<any>(db, 'get_presence', [PA])).live.windows.length,
      2,
    );
    await activate(db, removal);
    await assert.rejects(
      rpc(db, 'prepare_presence_release', [
        'a'.repeat(40),
        [sub.revisionId],
        [{ projectId: PA, decisionId: state.approved.id }],
      ]),
      /STALE_RELEASE/,
    );
    assert.deepEqual(
      (await rpc<any>(db, 'get_presence', [PA])).live.windows,
      [],
    );
    await rpc(db, 'set_project_exclusion', [PA, true]);
    assert.equal(
      (await rpc<any>(db, 'get_project_signage', [PA])).status,
      'withdrawal_requested',
    );
    assert.equal(
      (await rpc<any>(db, 'get_signage_catalogue')).status,
      'withdrawal_pending',
    );
  } finally {
    await db.close();
  }
});
test('event changes and revoked exact decisions block stale activation; compatible event copy does not reinterpret slots', async () => {
  const db = await database();
  try {
    const { sub } = await approvedProfile(db);
    const hours = await approvedHours(db);
    const record = await rpc<any>(db, 'get_presence', [PA]);
    const args = [
      'a'.repeat(40),
      [sub.revisionId],
      [{ projectId: PA, decisionId: record.approved.id }],
    ];
    const rel = await rpc<any>(db, 'prepare_presence_release', args);
    const job = await rpc<string>(db, 'approve_and_queue_release', [
      rel.releaseId,
      rel.digest,
    ]);
    await rpc(db, 'decide_presence', [
      hours.revisionId,
      hours.digest,
      1,
      'changes_requested',
      null,
      'Please confirm your final hours',
      '',
      '',
      false,
      randomUUID(),
    ]);
    await asUser(db, null, 'service_role');
    await assert.rejects(
      rpc(db, 'worker_claim', [job, 'stale-hours']),
      /STALE_RELEASE/,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    await rpc(db, 'decide_presence', [
      hours.revisionId,
      hours.digest,
      2,
      'approved',
      null,
      '',
      '',
      '',
      false,
      randomUUID(),
    ]);
    const approved = await rpc<any>(db, 'get_presence', [PA]);
    const admin = await rpc<any>(db, 'get_event_administration');
    await rpc(db, 'record_event_config', [
      1,
      { ...admin.event.config, arrivalInformation: 'Updated public text' },
      admin.event.themes,
    ]);
    await rpc(db, 'prepare_presence_release', [
      'a'.repeat(40),
      [sub.revisionId],
      [{ projectId: PA, decisionId: approved.approved.id }],
    ]);
    await rpc(db, 'record_event_config', [
      2,
      { ...admin.event.config, startTime: '10:00' },
      admin.event.themes,
    ]);
    await assert.rejects(
      rpc(db, 'prepare_presence_release', [
        'a'.repeat(40),
        [sub.revisionId],
        [{ projectId: PA, decisionId: approved.approved.id }],
      ]),
      /PRESENCE_SELECTION_REQUIRED/,
    );
  } finally {
    await db.close();
  }
});
