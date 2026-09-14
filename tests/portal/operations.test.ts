import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  database,
  asUser,
  rpc,
  A,
  B,
  O,
  U,
  PA,
  fields,
} from './database-harness.ts';
import { preparePortalRevision } from '../../editorial/portal-validator.ts';
async function approved(db: Awaited<ReturnType<typeof database>>) {
  await asUser(db, A);
  await rpc(db, 'save_project_draft', [PA, 0, fields]);
  const sub = await rpc(db, 'submit_project_revision', [PA, 1, randomUUID()]);
  await asUser(db, null, 'service_role');
  const job = await rpc(db, 'worker_claim', [sub.jobId, 'operations']);
  const prepared = await preparePortalRevision(
    await rpc(db, 'worker_subject', [job.jobId, job.attemptId]),
    async () => {
      throw new Error();
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
  return { ...sub, digest: prepared.digest };
}
test('activation lock survives an expired worker; late completion and blind retry are denied', async () => {
  const db = await database();
  try {
    const sub = await approved(db);
    const r1 = await rpc(db, 'prepare_release', [
        'a'.repeat(40),
        [sub.revisionId],
      ]),
      r2 = await rpc(db, 'prepare_release', ['a'.repeat(40), [sub.revisionId]]);
    const j1 = await rpc(db, 'approve_and_queue_release', [
        r1.releaseId,
        r1.digest,
      ]),
      j2 = await rpc(db, 'approve_and_queue_release', [
        r2.releaseId,
        r2.digest,
      ]);
    await asUser(db, null, 'service_role');
    const run = await rpc(db, 'worker_claim', [j1, 'first']);
    assert.equal(await rpc(db, 'worker_claim', [j2, 'second']), null);
    await assert.rejects(
      rpc(db, 'worker_verified', [
        j1,
        run.attemptId,
        r1.digest,
        { verified: true },
      ]),
      /INVALID_PUBLICATION_RECEIPT/,
    );
    await db.exec('reset role');
    await db.query(
      "update editorial.jobs set lease_until=now()-interval '1 minute' where id=$1",
      [j1],
    );
    await asUser(db, null, 'service_role');
    assert.equal((await rpc(db, 'worker_reconcile')).reconciled, 1);
    await assert.rejects(
      rpc(db, 'worker_record_deployment', [
        j1,
        run.attemptId,
        { origin: 'https://invalid.example' },
      ]),
      /STALE_ATTEMPT/,
    );
    assert.equal(await rpc(db, 'worker_claim', [j2, 'still-locked']), null);
    await assert.rejects(
      rpc(db, 'worker_recovery_unlock', [
        j1,
        run.attemptId,
        { runStopped: true },
      ]),
      /RECOVERY_EVIDENCE_REQUIRED/,
    );
    await rpc(db, 'worker_recovery_unlock', [
      j1,
      run.attemptId,
      {
        runStopped: true,
        providerChecked: true,
        ownerRecoveryReference: 'synthetic-no-provider-test',
      },
    ]);
    assert.ok(
      await rpc(db, 'worker_claim', [j2, 'after-owner-reconciliation']),
    );
  } finally {
    await db.close();
  }
});
test('organiser metadata invalidates stale approvals; edit freeze and owner role checks survive raw RPC calls', async () => {
  const db = await database();
  try {
    const sub = await approved(db);
    await rpc(db, 'update_project_metadata', [
      PA,
      1,
      {
        theme: 'world',
        room: null,
        duration: null,
        schedule: null,
        accessNotes: null,
        relatedIds: [],
      },
    ]);
    await assert.rejects(
      rpc(db, 'decide_revision', [
        sub.revisionId,
        sub.digest,
        1,
        'approved',
        '',
        '',
      ]),
      /STALE_REVIEW/,
    );
    await assert.rejects(
      rpc(db, 'prepare_release', ['a'.repeat(40), [sub.revisionId]]),
      /INELIGIBLE_SELECTION/,
    );
    await rpc(db, 'set_editing_open', [false]);
    await asUser(db, A);
    await assert.rejects(
      rpc(db, 'save_project_draft', [PA, 1, fields]),
      /EDITING_CLOSED/,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    await assert.rejects(
      rpc(db, 'set_event_role', [O, 'owner', false]),
      /OWNER_REQUIRED/,
    );
    await rpc(db, 'set_event_role', [U, 'organiser', true]);
    await asUser(db, U, 'authenticated', 'aal2');
    await assert.rejects(rpc(db, 'set_editing_open', [true]), /OWNER_REQUIRED/);
  } finally {
    await db.close();
  }
});
test('provisioning uncertainty is journalled and cannot be rebound to another project or repeatedly create accounts', async () => {
  const db = await database();
  try {
    const request = randomUUID();
    await asUser(db, A);
    await assert.rejects(
      rpc(db, 'begin_provisioning', [request, PA, 'synthetic@example.invalid']),
      /ACCESS_DENIED/,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal(
      (
        await rpc(db, 'begin_provisioning', [
          request,
          PA,
          'synthetic@example.invalid',
        ])
      ).action,
      'create',
    );
    assert.equal(
      (
        await rpc(db, 'begin_provisioning', [
          request,
          PA,
          'synthetic@example.invalid',
        ])
      ).action,
      'needs_review',
    );
    await assert.rejects(
      rpc(db, 'begin_provisioning', [request, PA, 'changed@example.invalid']),
      /REQUEST_CONFLICT/,
    );
    await assert.rejects(
      rpc(db, 'worker_finish_provisioning', [request, U]),
      /permission denied/,
    );
    await assert.rejects(
      rpc(db, 'worker_record_invitation', [request]),
      /permission denied/,
    );
    await asUser(db, null, 'service_role');
    await rpc(db, 'worker_finish_provisioning', [request, U]);
    await assert.rejects(
      rpc(db, 'worker_finish_provisioning', [request, A]),
      /PROVISIONING_STATE_CONFLICT/,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    // Historical account-only receipts must never claim that mail was sent.
    assert.equal(await rpc(db, 'invitation_receipt', [request]), false);
    assert.equal(
      (
        await rpc(db, 'begin_provisioning', [
          request,
          PA,
          'synthetic@example.invalid',
        ])
      ).action,
      'complete',
    );
    const invitedRequest = randomUUID();
    await rpc(db, 'begin_provisioning', [
      invitedRequest,
      PA,
      'invited@example.invalid',
    ]);
    await asUser(db, null, 'service_role');
    await rpc(db, 'worker_record_invitation', [invitedRequest]);
    await rpc(db, 'worker_finish_provisioning', [invitedRequest, B]);
    await assert.rejects(
      rpc(db, 'worker_record_invitation', [invitedRequest]),
      /PROVISIONING_STATE_CONFLICT/,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal(await rpc(db, 'invitation_receipt', [invitedRequest]), true);
    await asUser(db, A);
    await assert.rejects(
      rpc(db, 'invitation_receipt', [invitedRequest]),
      /ACCESS_DENIED/,
    );
  } finally {
    await db.close();
  }
});
