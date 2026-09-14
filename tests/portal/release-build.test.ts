import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import {
  database,
  asUser,
  rpc,
  A,
  B,
  O,
  PA,
  PB,
  fields,
} from './database-harness.ts';
import { preparePortalRevision } from '../../editorial/portal-validator.ts';
import {
  buildPortalCandidate,
  type WorkerAdapter,
} from '../../editorial/portal-worker.ts';

test('two-project approved SQL release builds real static files; pending draft and private evidence never enter output; source-only release retains content', async () => {
  const db = await database(),
    media = new Map<string, Buffer>(),
    revisions: string[] = [];
  try {
    const image = await sharp({
      create: { width: 48, height: 24, channels: 3, background: '#cc4488' },
    })
      .png()
      .toBuffer();
    for (const [user, project] of [
      [A, PA],
      [B, PB],
    ]) {
      await asUser(db, user);
      const asset = await rpc(db, 'reserve_upload', [
        project,
        'image/png',
        image.length,
      ]);
      await db.query(
        'insert into storage.objects(bucket_id,name) values($1,$2)',
        ['source-uploads', asset.path],
      );
      await rpc(db, 'save_project_draft', [
        project,
        0,
        {
          ...fields,
          title: `Synthetic ${user === A ? 'A' : 'B'}`,
          assetId: asset.assetId,
          alt: 'Synthetic magenta rectangle',
          credit: 'Local fixture',
          accessProposal: 'PRIVATE_ACCESS_CANARY',
        },
      ]);
      const sub = await rpc(db, 'submit_project_revision', [
        project,
        1,
        randomUUID(),
      ]);
      revisions.push(sub.revisionId);
      await asUser(db, null, 'service_role');
      const job = await rpc(db, 'worker_claim', [sub.jobId, 'build-proof']);
      const prepared = await preparePortalRevision(
        await rpc(db, 'worker_subject', [job.jobId, job.attemptId]),
        async () => image,
      );
      for (const item of prepared.derived) media.set(item.path, item.bytes);
      await rpc(db, 'worker_prepare', [
        job.jobId,
        job.attemptId,
        prepared.snapshot,
        prepared.digest,
        prepared.derived.map(({ bytes: _, ...item }) => item),
        'a'.repeat(40),
      ]);
      await asUser(db, O, 'authenticated', 'aal2');
      await rpc(db, 'decide_revision', [
        sub.revisionId,
        prepared.digest,
        0,
        'approved',
        '',
        'PRIVATE_NOTE_CANARY',
      ]);
    }
    const release = await rpc(db, 'prepare_release', [
      'a'.repeat(40),
      revisions,
    ]);
    await asUser(db, A);
    await rpc(db, 'save_project_draft', [
      PA,
      1,
      { ...fields, description: 'PENDING_DRAFT_CANARY' },
    ]);
    const adapter: WorkerAdapter = {
      rpc: async () => {
        throw new Error('Build must not query live drafts');
      },
      download: async (bucket, path) => {
        assert.equal(bucket, 'prepared-media');
        return media.get(path)!;
      },
      upload: async () => {
        throw new Error('No uploads in local build');
      },
    };
    const built = await buildPortalCandidate(adapter, release.manifest, {
      approvedAt: new Date().toISOString(),
      approvedBy: O,
    });
    assert.equal(built.snapshot.projects.length, 2);
    for (const file of built.files.filter((f) =>
      /\.(html|json|js|css|txt)$/.test(f.path),
    )) {
      const bytes = await readFile(join(built.site, file.path), 'utf8');
      for (const marker of [
        'PRIVATE_ACCESS_CANARY',
        'PRIVATE_NOTE_CANARY',
        'PENDING_DRAFT_CANARY',
        'synthetic@example.invalid',
      ])
        assert.ok(!bytes.includes(marker), `${file.path} leaked ${marker}`);
    }
    for (const file of built.files.filter((f) => f.path.endsWith('.webp')))
      assert.ok(
        [...media.values()].some(
          (bytes) =>
            createHash('sha256').update(bytes).digest('hex') === file.sha256,
        ),
      );
    await asUser(db, O, 'authenticated', 'aal2');
    await rpc(db, 'register_reviewed_source', ['b'.repeat(40)]);
    const rebrand = await rpc(db, 'prepare_release', [
      'b'.repeat(40),
      revisions,
    ]);
    assert.deepEqual(rebrand.manifest.projects, release.manifest.projects);
    assert.notEqual(rebrand.digest, release.digest);
    const rebuilt = await buildPortalCandidate(adapter, rebrand.manifest, {
      approvedAt: new Date().toISOString(),
      approvedBy: O,
    });
    assert.equal(rebuilt.snapshot.revision, built.snapshot.revision);
    // Restore a real PostgreSQL data-directory archive and independently copied
    // synthetic Storage bytes. This is not Supabase service/production restore proof.
    await db.exec('reset role');
    const backup = await db.dumpDataDir();
    const restored = new PGlite({ loadDataDir: backup });
    try {
      await asUser(restored, A);
      assert.equal(
        (await rpc(restored, 'get_project_draft', [PA])).fields.description,
        'PENDING_DRAFT_CANARY',
      );
      await asUser(restored, B);
      await assert.rejects(
        rpc(restored, 'get_project_draft', [PA]),
        /ACCESS_DENIED/,
      );
      await asUser(restored, O, 'authenticated', 'aal2');
      assert.equal((await rpc(restored, 'get_releases')).length, 2);
      const restoredBytes = new Map(
        [...media].map(([key, bytes]) => [key, Buffer.from(bytes)]),
      );
      assert.deepEqual(restoredBytes, media);
    } finally {
      await restored.close();
    }
  } finally {
    await db.close();
  }
});
