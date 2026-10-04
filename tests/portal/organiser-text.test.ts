import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, asUser, rpc, A, O, PA, fields } from './database-harness.ts';
import {
  preparePortalRevision,
  snapshotFromManifest,
} from '../../editorial/portal-validator.ts';
import { renderProjectBody } from '../../src/lib/project-renderer.ts';
import { releaseBlockers } from '../../src/lib/content-schema.ts';

test('owner text publication is exact, MFA-bound, media-free and never declares participant permission', async () => {
  const db = await database();
  try {
    await asUser(db, A);
    const original = {
      ...fields,
      permission: false,
      invitation: '',
      visitorAction: '',
      encounters: [],
      assetId: null,
      processNote: 'Public process text',
      accessProposal: 'PRIVATE_ACCESS_CANARY',
      links: [{ label: 'PRIVATE_LINK_CANARY', url: 'https://example.invalid' }],
      videoUrl: 'https://example.invalid/video',
    };
    await rpc(db, 'save_project_draft', [PA, 0, original]);
    const request = randomUUID();
    await assert.rejects(
      rpc(db, 'submit_organiser_text_revision', [PA, 1, 1, request]),
      /ACCESS_DENIED/,
    );
    await assert.rejects(
      rpc(db, 'submit_project_revision', [PA, 1, request]),
      /REQUIRED_FIELDS/,
    );
    await asUser(db, O);
    await assert.rejects(
      rpc(db, 'submit_organiser_text_revision', [PA, 1, 1, request]),
      /MFA_REQUIRED/,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    await assert.rejects(
      rpc(db, 'submit_organiser_text_revision', [PA, 0, 1, request]),
      /DRAFT_CONFLICT/,
    );
    await assert.rejects(
      rpc(db, 'submit_organiser_text_revision', [PA, 1, 2, request]),
      /METADATA_CONFLICT/,
    );
    const submitted = await rpc(db, 'submit_organiser_text_revision', [
      PA,
      1,
      1,
      request,
    ]);
    assert.deepEqual(
      await rpc(db, 'submit_organiser_text_revision', [PA, 1, 1, request]),
      submitted,
    );
    assert.deepEqual(
      (await rpc(db, 'get_project_draft', [PA])).fields,
      original,
    );
    await asUser(db, null, 'service_role');
    const job = await rpc(db, 'worker_claim', [
      submitted.jobId,
      'organiser-text-test',
    ]);
    const subject = await rpc(db, 'worker_subject', [job.jobId, job.attemptId]);
    assert.equal(subject.fields.permission, false);
    await assert.rejects(
      preparePortalRevision(subject, async () => {
        throw Error('No media allowed');
      }),
      /VALIDATION_FAILED/,
    );
    subject.authorisation = await rpc(db, 'worker_revision_authorisation', [
      job.jobId,
      job.attemptId,
    ]);
    assert.equal(subject.authorisation, 'organiser-text-v1');
    const prepared = await preparePortalRevision(subject, async () => {
      throw Error('No media allowed');
    });
    assert.equal(prepared.snapshot.publicationBasis, 'organiser-text');
    assert.equal(prepared.snapshot.media, null);
    assert.deepEqual(prepared.derived, []);
    assert.equal(prepared.snapshot.description, original.description);
    const html = renderProjectBody(prepared.snapshot);
    assert(!html.includes('PRIVATE_'));
    assert(!html.includes('What you’ll do'));
    assert(html.includes('Not confirmed'));
    await assert.rejects(
      preparePortalRevision(
        {
          ...subject,
          fields: { ...subject.fields, videoUrl: 'https://example.invalid' },
        },
        async () => Buffer.alloc(0),
      ),
      /VALIDATION_FAILED/,
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
      submitted.revisionId,
      prepared.digest,
      0,
      'approved',
      '',
      'Owner authorised text only',
    ]);
    const release = await rpc(db, 'prepare_release', [
      'a'.repeat(40),
      [submitted.revisionId],
    ]);
    const snapshot = snapshotFromManifest(release.manifest);
    assert.equal(
      releaseBlockers(snapshot).includes('approved project media'),
      false,
    );
    await asUser(db, A);
    await rpc(db, 'save_project_draft', [
      PA,
      1,
      { ...original, description: 'PENDING_DRAFT_CANARY' },
    ]);
    assert.equal(snapshot.projects[0].description, original.description);
    assert.equal(
      (await rpc(db, 'get_project_draft', [PA])).fields.permission,
      false,
    );
    await db.exec('reset role');
    const evidence = (
      await db.query(
        'select actor,terms_version from editorial.permission_evidence where revision_id=$1',
        [submitted.revisionId],
      )
    ).rows;
    assert.deepEqual(evidence, [
      { actor: O, terms_version: 'organiser-text-v1' },
    ]);
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::int as n from editorial.revision_assets where revision_id=$1',
          [submitted.revisionId],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
