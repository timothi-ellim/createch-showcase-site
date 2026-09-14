import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentError } from '../../src/lib/content-schema.ts';
import {
  runPublication,
  runValidation,
  workerAdapter,
  cloudflareHosting,
  type WorkerAdapter,
  type HostingAdapter,
} from '../../editorial/portal-worker.ts';
import { dispatchHandler } from '../../editorial/portal-control.ts';
import { checkPortalEnvironment } from '../../src/lib/portal-contract.ts';
import { renderProjectBody } from '../../src/lib/project-renderer.ts';
import { preparePortalRevision } from '../../editorial/portal-validator.ts';
import { fields, PA } from './database-harness.ts';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

test('Access credentials cover the protected staging canonical Pages URL and its previews, never other hosts', async () => {
  const hosting = cloudflareHosting({
    CREATECH_PAGES_PROJECT: 'createch-staging',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_API_TOKEN: 'synthetic-deploy-token',
    CREATECH_HOSTING_ENABLED: 'true',
    CREATECH_CANDIDATE_PROTECTION_VERIFIED: 'true',
    CREATECH_CANONICAL_ORIGIN: 'https://createch-staging.pages.dev/',
    PORTAL_ENVIRONMENT: 'staging',
    CF_ACCESS_CLIENT_ID: 'synthetic-client',
    CF_ACCESS_CLIENT_SECRET: 'synthetic-secret',
  });
  const revision = 'a'.repeat(64),
    bytes = Buffer.from(JSON.stringify({ revision }));
  for (const [origin, authorised] of [
    ['https://createch-staging.pages.dev/', true],
    ['https://candidate.createch-staging.pages.dev/', true],
    ['https://other-createch-staging.pages.dev/', false],
    ['https://createch-staging.pages.dev.example.com/', false],
  ] as const) {
    let calls = 0;
    await hosting.verify(
      {
        schemaVersion: 1,
        revision,
        origin,
        files: [
          {
            path: 'content-revision.json',
            size: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
        ],
      },
      async (_input, init) => {
        calls++;
        const headers = new Headers(init?.headers);
        assert.equal(
          headers.get('CF-Access-Client-Id'),
          authorised ? 'synthetic-client' : null,
        );
        assert.equal(
          headers.get('CF-Access-Client-Secret'),
          authorised ? 'synthetic-secret' : null,
        );
        assert.equal(init?.redirect, 'error');
        return new Response(bytes);
      },
    );
    assert.equal(calls, 2);
  }
});

test('worker verifies the stored environment before any claim, media read or upload', async () => {
  const original = globalThis.fetch,
    paths: string[] = [];
  globalThis.fetch = async (input) => {
    paths.push(new URL(String(input)).pathname);
    return new Response(
      JSON.stringify({
        environment: 'production',
        targetId: null,
        targetOrigin: null,
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const adapter = workerAdapter({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SECRET_KEY: 'synthetic-key-not-a-credential',
      PORTAL_ENVIRONMENT: 'local',
      PORTAL_APP_ORIGIN: 'http://127.0.0.1:4321',
    });
    await assert.rejects(
      adapter.rpc('worker_claim', { p_job: PA, p_run: 'fixture' }),
      /WORKER_DATABASE_ENVIRONMENT_MISMATCH/,
    );
    await assert.rejects(
      adapter.download('source-uploads', 'fixture'),
      /WORKER_DATABASE_ENVIRONMENT_MISMATCH/,
    );
    await assert.rejects(
      adapter.upload('prepared-media', 'fixture', Buffer.alloc(0)),
      /WORKER_DATABASE_ENVIRONMENT_MISMATCH/,
    );
    assert.deepEqual(paths, ['/rest/v1/rpc/worker_environment']);
  } finally {
    globalThis.fetch = original;
  }
});

test('mixed environments and unexpected credentials in endpoints fail before any network request', () => {
  assert.doesNotThrow(() =>
    checkPortalEnvironment(
      'http://127.0.0.1:54321',
      'local',
      'http://127.0.0.1:4321',
    ),
  );
  for (const [url, env, origin] of [
    ['https://project.supabase.co', 'local', 'http://localhost:4321'],
    ['http://localhost:54321', 'production', 'https://public.example'],
    [
      'https://user:password@project.supabase.co',
      'production',
      'https://public.example',
    ],
    [
      'https://project.supabase.co?token=x',
      'staging',
      'https://preview.example',
    ],
  ])
    assert.throws(() => checkPortalEnvironment(url, env, origin));
});
test('fixed dispatch denies key-only, wrong origin, extra target arguments and unauthorised job; outage retains queue', async () => {
  let count = 0,
    failed = false;
  const handler = dispatchHandler({
    origin: 'https://portal.example',
    authenticate: async (token) => {
      if (token !== 'Bearer user-session') throw new Error();
      return {
        rpc: async (_name, args) => {
          if (args.p_job !== PA) throw new Error();
          return { status: 'queued' };
        },
      };
    },
    dispatch: async () => {
      count++;
      if (failed) throw new Error();
    },
  });
  const request = (
    body: unknown,
    auth = 'Bearer user-session',
    origin = 'https://portal.example',
  ) =>
    new Request(origin, {
      method: 'POST',
      headers: { origin, authorization: auth },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await handler(request({ jobId: PA }, 'Bearer publishable-key'))).status,
    403,
  );
  assert.equal(
    (
      await handler(
        request(
          { jobId: PA },
          'Bearer user-session',
          'https://attacker.example',
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (await handler(request({ jobId: PA, repository: 'elsewhere' }))).status,
    400,
  );
  assert.equal((await handler(request({ jobId: randomUUID() }))).status, 403);
  assert.equal(count, 0);
  assert.equal((await handler(request({ jobId: PA }))).status, 202);
  failed = true;
  const failure = await handler(request({ jobId: PA }));
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).queued, true);
});
test('trusted validator uses organiser facts, strips private proposals and decodes actual image bytes', async () => {
  const aid = randomUUID(),
    rid = randomUUID();
  const bytes = await sharp({
    create: { width: 32, height: 16, channels: 3, background: '#33aa77' },
  })
    .png()
    .withMetadata()
    .toBuffer();
  const subject = {
    revisionId: rid,
    publicId: 'fixture-01',
    slug: 'sample-image-study',
    fields: {
      ...fields,
      assetId: aid,
      alt: 'A green synthetic rectangle',
      credit: 'Synthetic test asset',
      accessProposal: 'PRIVATE_PROPOSAL',
    },
    metadata: { theme: 'image', accessNotes: 'Organiser confirmed warning' },
    asset: {
      id: aid,
      path: `${PA}/${aid}`,
      bytes: bytes.length,
      type: 'image/png',
    },
  };
  const result = await preparePortalRevision(subject, async () => bytes);
  assert.equal(result.snapshot.accessNotes, 'Organiser confirmed warning');
  assert.ok(!JSON.stringify(result.snapshot).includes('PRIVATE_PROPOSAL'));
  assert.equal(result.derived.length, 1);
  const meta = await sharp(result.derived[0].bytes).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  await assert.rejects(
    preparePortalRevision(
      { ...subject, asset: { ...subject.asset, id: randomUUID() } },
      async () => bytes,
    ),
    /ASSET_BINDING_INVALID/,
  );
  await assert.rejects(
    preparePortalRevision(
      {
        ...subject,
        fields: {
          ...subject.fields,
          links: [{ label: 'private', url: 'javascript:alert(1)' }],
        },
      },
      async () => bytes,
    ),
    /VALIDATION_FAILED/,
  );
  const html = renderProjectBody(
    {
      ...result.snapshot,
      title: '<img src=x onerror=alert(1)>',
      links: [{ label: '<script>', url: 'javascript:alert(1)' }],
    },
    { privatePreview: true },
  );
  assert.ok(!html.includes('onerror=' + '"'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('href="javascript:'));
});
function scenario(failAt: string | null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const source = 'a'.repeat(40),
    manifest: any = {
      sourceCommit: source,
      environment: 'production',
      targetOrigin: 'https://public.example/',
      targetId: 'target',
    };
  const adapter: WorkerAdapter = {
    rpc: async <T>(name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (name === 'worker_subject')
        return {
          manifest,
          digest: 'd'.repeat(64),
          approvedAt: '2026-09-14T00:00:00Z',
          approvedBy: PA,
        } as T;
      if (name === failAt) throw new ContentError('STALE_RELEASE');
      return undefined as T;
    },
    download: async () => Buffer.alloc(0),
    upload: async () => {},
  };
  let production = 0;
  const hosting: HostingAdapter = {
    targetId: 'target',
    canonicalOrigin: manifest.targetOrigin,
    environment: 'production',
    candidate: async () => ({
      origin: 'https://candidate.example/',
      deploymentId: 'candidate',
    }),
    production: async () => {
      production++;
      if (failAt === 'upload') throw new ContentError('HOSTING_TIMEOUT');
      return { origin: 'https://deployment.example/', deploymentId: 'real-id' };
    },
    verify: async (value: any) => {
      if (failAt === value.origin)
        throw new ContentError('DEPLOYED_FILE_MISMATCH');
      return {
        outcome: 'deployed-revision-verified',
        revision: 'r',
        origin: value.origin,
        verifiedAt: '2026-09-14T00:00:00Z',
        checkedFiles: 2,
      };
    },
  };
  const build = async () => {
    if (failAt === 'build') throw new ContentError('BUILD_FAILED');
    return {
      site: 'synthetic-only-path',
      snapshot: { revision: 'a'.repeat(64) } as any,
      files: [],
      artifactHash: 'b'.repeat(64),
    };
  };
  return {
    calls,
    adapter,
    hosting,
    build,
    source,
    production: () => production,
  };
}
const job = {
  jobId: randomUUID(),
  subjectId: randomUUID(),
  attemptId: randomUUID(),
  kind: 'publish' as const,
};
for (const failure of [
  'build',
  'https://candidate.example/',
  'worker_activation_check',
  'upload',
  'https://public.example/',
])
  test(`publication ${failure} failure never produces a verified-live receipt`, async () => {
    const s = scenario(failure);
    await assert.rejects(
      runPublication(s.adapter, s.hosting, job, s.source, s.build),
    );
    assert.ok(!s.calls.some((c) => c.name === 'worker_verified'));
    const report = s.calls.find((c) => c.name === 'worker_fail')!;
    assert.equal(
      report.args.p_activation_possible,
      ['upload', 'https://public.example/'].includes(failure),
    );
    if (
      [
        'build',
        'https://candidate.example/',
        'worker_activation_check',
      ].includes(failure)
    )
      assert.equal(s.production(), 0);
  });
test('publication verifies candidate, deployment and canonical target before recording observed success', async () => {
  const s = scenario(null);
  await runPublication(s.adapter, s.hosting, job, s.source, s.build);
  assert.equal(s.production(), 1);
  assert.equal(s.calls.at(-1)?.name, 'worker_verified');
  assert.equal(
    s.calls.filter((c) => c.name === 'worker_record_deployment').length,
    1,
  );
});
test('worker validation failure cannot create a prepared receipt', async () => {
  const s = scenario(null);
  await assert.rejects(runValidation(s.adapter, job, s.source));
  assert.ok(!s.calls.some((c) => c.name === 'worker_prepare'));
});
