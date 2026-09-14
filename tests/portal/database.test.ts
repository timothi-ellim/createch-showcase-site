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
  PB,
  fields,
} from './database-harness.ts';
import {
  preparePortalRevision,
  snapshotFromManifest,
} from '../../editorial/portal-validator.ts';

test('clean migrations: actual database grants, RPC isolation and retained-identity revocation', async () => {
  const db = await database();
  try {
    await asUser(db, null, 'anon');
    await assert.rejects(rpc(db, 'get_my_projects'), /permission denied/);
    await assert.rejects(
      db.query('select * from editorial.drafts'),
      /permission denied/,
    );
    await asUser(db, A);
    assert.equal((await rpc(db, 'get_my_projects')).length, 1);
    assert.equal(
      (await rpc(db, 'get_project_draft', [PA])).publicId,
      'fixture-01',
    );
    await assert.rejects(rpc(db, 'get_project_draft', [PB]), /ACCESS_DENIED/);
    await assert.rejects(
      rpc(db, 'save_project_draft', [PB, 0, fields]),
      /ACCESS_DENIED/,
    );
    await assert.rejects(
      rpc(db, 'set_membership', [PB, A, true]),
      /ACCESS_DENIED/,
    );
    await assert.rejects(
      db.query('update editorial.projects set withdrawn=true'),
      /permission denied/,
    );
    await assert.rejects(rpc(db, 'worker_queued'), /permission denied/);
    await assert.rejects(
      rpc(db, 'save_project_draft', [PA, 0, { ...fields, role: 'owner' }]),
      /UNEXPECTED_FIELD/,
    );
    await asUser(db, U);
    assert.deepEqual(await rpc(db, 'get_my_projects'), []);
    await asUser(db, O);
    await assert.rejects(
      rpc(db, 'set_membership', [PA, A, false]),
      /MFA_REQUIRED/,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    await rpc(db, 'set_membership', [PA, A, false]);
    await asUser(db, A);
    await assert.rejects(rpc(db, 'get_project_draft', [PA]), /ACCESS_DENIED/);
    await assert.rejects(
      rpc(db, 'reserve_upload', [PA, 'image/png', 100]),
      /ACCESS_DENIED/,
    );
    await asUser(db, B);
    assert.equal((await rpc(db, 'get_my_projects')).length, 1);
  } finally {
    await db.close();
  }
});

test('draft concurrency, immutable/idempotent submit, worker fencing and exact decision separation', async () => {
  const db = await database();
  try {
    await asUser(db, A);
    await rpc(db, 'save_project_draft', [PA, 0, fields]);
    await assert.rejects(
      rpc(db, 'save_project_draft', [PA, 0, { ...fields, title: 'stale' }]),
      /DRAFT_CONFLICT/,
    );
    const request = randomUUID(),
      submission = await rpc(db, 'submit_project_revision', [PA, 1, request]);
    assert.deepEqual(
      await rpc(db, 'submit_project_revision', [PA, 1, request]),
      submission,
    );
    await asUser(db, B);
    await assert.rejects(
      rpc(db, 'get_revision_preview', [submission.revisionId]),
      /ACCESS_DENIED/,
    );
    await asUser(db, null, 'service_role');
    const job = await rpc(db, 'worker_claim', [submission.jobId, 'unit-run']);
    assert.equal(
      await rpc(db, 'worker_claim', [submission.jobId, 'duplicate']),
      null,
    );
    await assert.rejects(
      rpc(db, 'worker_subject', [submission.jobId, randomUUID()]),
      /STALE_ATTEMPT/,
    );
    const subject = await rpc(db, 'worker_subject', [
      submission.jobId,
      job.attemptId,
    ]);
    const prepared = await preparePortalRevision(subject, async () => {
      throw new Error('No image should be fetched');
    });
    await rpc(db, 'worker_prepare', [
      submission.jobId,
      job.attemptId,
      prepared.snapshot,
      prepared.digest,
      [],
      'a'.repeat(40),
    ]);
    await asUser(db, O, 'authenticated', 'aal2');
    await assert.rejects(
      rpc(db, 'decide_revision', [
        submission.revisionId,
        'b'.repeat(64),
        0,
        'approved',
        '',
        '',
      ]),
      /PREPARED_VERSION_REQUIRED/,
    );
    await rpc(db, 'decide_revision', [
      submission.revisionId,
      prepared.digest,
      0,
      'approved',
      'Visible feedback',
      'PRIVATE_NOTE_CANARY',
    ]);
    await asUser(db, A);
    const preview = await rpc(db, 'get_revision_preview', [
      submission.revisionId,
    ]);
    assert.equal(preview.feedback, 'Visible feedback');
    assert.ok(!JSON.stringify(preview).includes('PRIVATE_NOTE_CANARY'));
    await rpc(db, 'save_project_draft', [
      PA,
      1,
      { ...fields, description: 'Later unapproved draft.' },
    ]);
    assert.equal(
      (await rpc(db, 'get_revision_preview', [submission.revisionId])).prepared
        .description,
      fields.description,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    const release = await rpc(db, 'prepare_release', [
      'a'.repeat(40),
      [submission.revisionId],
    ]);
    const snapshot = snapshotFromManifest(release.manifest);
    assert.equal(snapshot.projects[0].description, fields.description);
    const publish = await rpc(db, 'approve_and_queue_release', [
      release.releaseId,
      release.digest,
    ]);
    assert.equal(
      await rpc(db, 'approve_and_queue_release', [
        release.releaseId,
        release.digest,
      ]),
      publish,
    );
    await rpc(db, 'set_project_exclusion', [PA, true]);
    await assert.rejects(
      rpc(db, 'approve_and_queue_release', [release.releaseId, release.digest]),
      /STALE_RELEASE/,
    );
    await asUser(db, null, 'service_role');
    await assert.rejects(
      rpc(db, 'worker_claim', [publish, 'stale-run']),
      /STALE_RELEASE/,
    );
  } finally {
    await db.close();
  }
});

test('private Storage policies require exact reservation, prevent replacement and reject foreign references', async () => {
  const db = await database();
  try {
    await asUser(db, A);
    const a = await rpc(db, 'reserve_upload', [PA, 'image/png', 100]);
    await db.query(
      'insert into storage.objects(bucket_id,name) values($1,$2)',
      ['source-uploads', a.path],
    );
    await assert.rejects(
      db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
        'source-uploads',
        `${PA}/${randomUUID()}`,
      ]),
      /row-level security/,
    );
    assert.equal(
      (
        await db.query('update storage.objects set name=$1 returning id', [
          'changed',
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query('delete from storage.objects returning id')).rows.length,
      0,
    );
    await asUser(db, B);
    assert.equal(
      (await db.query('select * from storage.objects')).rows.length,
      0,
    );
    await assert.rejects(
      rpc(db, 'save_project_draft', [PB, 0, { ...fields, assetId: a.assetId }]),
      /INVALID_ASSET/,
    );
    await assert.rejects(
      db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
        'prepared-media',
        `${PB}/${randomUUID()}`,
      ]),
      /row-level security/,
    );
  } finally {
    await db.close();
  }
});
