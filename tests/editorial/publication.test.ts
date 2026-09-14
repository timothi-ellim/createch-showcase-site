import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { request } from 'node:http';
import { approve, exportApproved } from '../../editorial/workflow.ts';
import {
  atomicJson,
  readJson,
  ensureStoreRoot,
  repositoryRoot,
  withStoreLock,
} from '../../editorial/store.ts';
import {
  publishLocal,
  verifyRelease,
  rollbackLocal,
  copyApprovedMedia,
  ensureBuildPath,
} from '../../editorial/publisher.ts';
import { approveMedia, mediaRegistry } from '../../editorial/media.ts';
import { createPreviewServer } from '../../editorial/server.ts';
import { readSnapshot } from '../../src/lib/content-schema.ts';
import { setup } from './helpers.ts';

async function privateRoot() {
  return realpath(await mkdtemp(join(tmpdir(), 'createch-test-')));
}
function snapshot() {
  const { state, organiser } = setup();
  approve(
    state,
    organiser.id,
    state.records[organiser.id].draft!.hash,
    'Synthetic test organiser',
  );
  return exportApproved(state);
}
async function fixtureBuild(input: string, output: string) {
  const data = readSnapshot(await readJson(input));
  const marker = `<meta name="createch-revision" content="${data.revision}">`;
  await mkdir(output, { recursive: true });
  await atomicJson(join(output, 'content-revision.json'), {
    revision: data.revision,
    projectIds: data.projects.map((p) => p.id),
  });
  await writeFile(
    join(output, 'index.html'),
    marker + '<h1>Synthetic publication test</h1>',
  );
  await writeFile(join(output, '404.html'), marker + '<h1>Not found</h1>');
  for (const project of data.projects) {
    await mkdir(join(output, 'projects', project.slug), { recursive: true });
    await writeFile(
      join(output, 'projects', project.slug, 'index.html'),
      marker + project.title,
    );
  }
}
test('private stores reject repository paths; writers cannot overlap', async () => {
  await assert.rejects(ensureStoreRoot(repositoryRoot), /OUTSIDE_REPOSITORY/);
  const root = await privateRoot();
  await withStoreLock(root, async () => {
    await assert.rejects(
      withStoreLock(root, async () => {}),
      /EDITORIAL_BUSY/,
    );
  });
  await withStoreLock(root, async () => {});
  assert.throws(
    () => ensureBuildPath(join(repositoryRoot, 'public')),
    /UNSAFE_BUILD_DIRECTORY/,
  );
});
test('real image decode strips metadata, creates bounded WebP, and rejects fake images', async () => {
  const root = await privateRoot();
  const source = join(root, 'synthetic.jpg');
  await sharp({
    create: { width: 1800, height: 900, channels: 3, background: '#ba9cef' },
  })
    .jpeg()
    .withMetadata({ density: 300 })
    .toFile(source);
  const media = await approveMedia(
    root,
    source,
    'Synthetic purple test rectangle',
    'Synthetic test fixture',
    'Test organiser',
  );
  const bytes = await readFile(
    join(root, 'approved-media', media.src.split('/').at(-1)!),
  );
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal((await mediaRegistry(root)).length, 1);
  await approveMedia(root, source, media.alt, media.credit, 'Test organiser');
  assert.equal((await mediaRegistry(root)).length, 1);
  const fake = join(root, 'fake.png');
  await writeFile(
    fake,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(100),
    ]),
  );
  await assert.rejects(
    approveMedia(root, fake, 'test', 'test', 'test'),
    /IMAGE_DECODE_FAILED/,
  );
  await assert.rejects(
    approveMedia(root, source, '', 'test', 'test'),
    /VALIDATION_FAILED/,
  );
  const publicData = snapshot();
  publicData.projects[0].media = media;
  const output = join(root, 'test-output');
  await copyApprovedMedia(publicData, join(root, 'approved-media'), output);
  await writeFile(
    join(root, 'approved-media', media.src.split('/').at(-1)!),
    'modified',
  );
  await assert.rejects(
    copyApprovedMedia(publicData, join(root, 'approved-media'), output),
    /MEDIA_HASH_MISMATCH/,
  );
});
test('activation is idempotent; missing/stale/private output and build failures preserve live pointer', async () => {
  const root = await privateRoot();
  const data = snapshot();
  const first = await publishLocal(root, data, { build: fixtureBuild });
  const unchanged = await publishLocal(root, data, {
    build: async () => {
      throw new Error('must not rebuild');
    },
  });
  assert.equal(unchanged.outcome, 'unchanged');
  const legacy = (await readJson(join(root, 'live.json'))) as any;
  delete legacy.active.sourceHash;
  await atomicJson(join(root, 'live.json'), legacy);
  let rebuilt = false;
  await publishLocal(root, data, {
    build: async (input, output) => {
      rebuilt = true;
      await fixtureBuild(input, output);
    },
  });
  assert.equal(
    rebuilt,
    true,
    'An older output without matching source evidence must be rebuilt',
  );
  const { state, organiser } = setup();
  approve(
    state,
    organiser.id,
    state.records[organiser.id].draft!.hash,
    'Test organiser',
  );
  state.records[organiser.id].withdrawn = true;
  const next = exportApproved(state);
  await assert.rejects(
    publishLocal(root, next, {
      build: async () => {
        throw new Error('Build failed');
      },
    }),
    /Build failed/,
  );
  await assert.rejects(
    publishLocal(root, next, {
      build: async (input, output) => {
        await fixtureBuild(input, output);
        await atomicJson(join(output, 'content-revision.json'), {
          revision: 'wrong',
        });
      },
    }),
    /BUILT_REVISION_MISMATCH/,
  );
  await assert.rejects(
    publishLocal(root, next, {
      build: async (input, output) => {
        await fixtureBuild(input, output);
        await writeFile(
          join(output, 'secret.json'),
          '{"ownerContact":"private"}',
        );
      },
    }),
    /PRIVATE_OR_STALE_MARKER/,
  );
  assert.equal(
    ((await readJson(join(root, 'live.json'))) as any).active.revision,
    first.release.revision,
  );
  const second = await publishLocal(root, next, { build: fixtureBuild });
  await rollbackLocal(root, first.release.artifactHash);
  await publishLocal(root, next, { build: fixtureBuild }); // Reuses an immutable generation after rollback.
  assert.equal(
    ((await readJson(join(root, 'live.json'))) as any).active.revision,
    second.release.revision,
  );
});
test('preview serves only verified files; modified assets fail closed and cannot be rolled back', async () => {
  const root = await privateRoot();
  const data = snapshot();
  const first = await publishLocal(root, data, { build: fixtureBuild });
  const server = createPreviewServer(root);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await fetch(`${origin}/state.json`)).status, 404);
    assert.equal((await fetch(`${origin}/.writer.lock`)).status, 404);
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
    const wrongHostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          origin,
          { headers: { host: 'attacker.example' } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
    assert.equal(wrongHostStatus, 403);
    assert.equal(
      (await fetch(origin, { method: 'HEAD' })).headers.get('x-robots-tag'),
      'noindex, nofollow',
    );
    await writeFile(
      join(root, 'publications', first.release.directory, 'index.html'),
      '<h1>tampered</h1>',
    );
    assert.equal((await fetch(origin)).status, 503);
    await assert.rejects(
      verifyRelease(root, first.release),
      /RELEASE_FILES_CHANGED/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
