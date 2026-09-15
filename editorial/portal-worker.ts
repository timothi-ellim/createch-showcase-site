import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ContentError, releaseBlockers } from '../src/lib/content-schema.ts';
import { checkPortalEnvironment } from '../src/lib/portal-contract.ts';
import {
  preparePortalRevision,
  snapshotFromManifest,
  type PortalManifest,
} from './portal-validator.ts';
import { runAstroBuild, verifyOutput } from './publisher.ts';
import { verifyDeployment } from './deployment.ts';
import { writeMediaDerivatives } from './media-derivatives.ts';

interface Job {
  jobId: string;
  kind: 'validate' | 'publish';
  subjectId: string;
  attemptId: string;
}
export interface WorkerAdapter {
  rpc: <T = any>(name: string, args?: Record<string, unknown>) => Promise<T>;
  download: (bucket: string, path: string) => Promise<Buffer>;
  upload: (bucket: string, path: string, bytes: Buffer) => Promise<void>;
}
export function workerAdapter(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerAdapter {
  const url = environment.SUPABASE_URL,
    key = environment.SUPABASE_SECRET_KEY,
    env = environment.PORTAL_ENVIRONMENT,
    origin = environment.PORTAL_APP_ORIGIN;
  if (!url || !key || !env || !origin)
    throw new ContentError('WORKER_CONFIGURATION_REQUIRED');
  checkPortalEnvironment(url, env, origin);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let checked: Promise<void> | undefined;
  const verifyEnvironment = () =>
    (checked ??= (async () => {
      const { data, error } = await client.rpc('worker_environment');
      if (
        error ||
        data?.environment !== env ||
        (environment.CREATECH_PAGES_PROJECT &&
          data.targetId !== environment.CREATECH_PAGES_PROJECT) ||
        (environment.CREATECH_CANONICAL_ORIGIN &&
          data.targetOrigin !== environment.CREATECH_CANONICAL_ORIGIN)
      )
        throw new ContentError('WORKER_DATABASE_ENVIRONMENT_MISMATCH');
    })());
  return {
    rpc: async (name, args = {}) => {
      await verifyEnvironment();
      const { data, error } = await client.rpc(name, args);
      if (error)
        throw new ContentError(
          /^[A-Z_]{3,80}$/.test(error.message)
            ? error.message
            : 'DATABASE_REQUEST_FAILED',
        );
      return data;
    },
    download: async (bucket, path) => {
      await verifyEnvironment();
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) throw new ContentError('PRIVATE_MEDIA_UNAVAILABLE');
      return Buffer.from(await data.arrayBuffer());
    },
    upload: async (bucket, path, bytes) => {
      await verifyEnvironment();
      const { error } = await client.storage
        .from(bucket)
        .upload(path, bytes, { contentType: 'image/webp', upsert: false });
      if (error) {
        const { data, error: readError } = await client.storage
          .from(bucket)
          .download(path);
        if (readError || !Buffer.from(await data.arrayBuffer()).equals(bytes))
          throw new ContentError('PREPARED_MEDIA_WRITE_FAILED');
      }
    },
  };
}
export async function runValidation(
  adapter: WorkerAdapter,
  job: Job,
  sourceCommit: string,
) {
  const subject = await adapter.rpc('worker_subject', {
    p_job: job.jobId,
    p_attempt: job.attemptId,
  });
  const prepared = await preparePortalRevision(subject, (path) =>
    adapter.download('source-uploads', path),
  );
  for (const media of prepared.derived)
    await adapter.upload('prepared-media', media.path, media.bytes);
  await adapter.rpc('worker_prepare', {
    p_job: job.jobId,
    p_attempt: job.attemptId,
    p_snapshot: prepared.snapshot,
    p_digest: prepared.digest,
    p_media: prepared.derived.map(({ bytes: _, ...media }) => media),
    p_commit: sourceCommit,
  });
}
export async function buildPortalCandidate(
  adapter: WorkerAdapter,
  manifest: PortalManifest,
  receipt: { approvedAt: string; approvedBy: string },
) {
  const snapshot = snapshotFromManifest(manifest);
  if (manifest.environment !== 'local' && releaseBlockers(snapshot).length)
    throw new ContentError('RELEASE_CONTENT_BLOCKED');
  const directory = resolve('.build-candidates', randomUUID());
  await mkdir(directory, { recursive: true });
  const input = join(directory, 'snapshot.json'),
    approval = join(directory, 'approval.private.json'),
    site = join(directory, 'site');
  await writeFile(input, JSON.stringify(snapshot));
  await writeFile(
    approval,
    JSON.stringify({
      snapshotRevision: snapshot.revision,
      authorised: true,
      approvedAt: receipt.approvedAt,
      approvedBy: receipt.approvedBy,
    }),
  );
  await runAstroBuild(
    input,
    site,
    manifest.environment === 'local' ? 'editorial-preview' : 'production',
    approval,
  );
  for (const project of manifest.projects)
    for (const media of project.media) {
      if (
        !/^[a-f0-9-]{36}\/[a-f0-9]{64}\.webp$/.test(media.path) ||
        media.src !== `/media/${media.sha256}.webp`
      )
        throw new ContentError('INVALID_MEDIA_PATH');
      const bytes = await adapter.download('prepared-media', media.path);
      if (createHash('sha256').update(bytes).digest('hex') !== media.sha256)
        throw new ContentError('PREPARED_MEDIA_HASH_MISMATCH');
      await mkdir(join(site, 'media'), { recursive: true });
      await writeFile(join(site, 'media', `${media.sha256}.webp`), bytes);
      await writeMediaDerivatives(bytes, media.sha256, site);
    }
  const verified = await verifyOutput(site, snapshot, [
    process.env.SUPABASE_SECRET_KEY || '',
    process.env.CLOUDFLARE_API_TOKEN || '',
  ]);
  return { site, snapshot, ...verified };
}
export interface HostingAdapter {
  targetId: string;
  canonicalOrigin: string;
  environment: 'staging' | 'production';
  candidate: (
    directory: string,
  ) => Promise<{ origin: string; deploymentId: string }>;
  production: (
    directory: string,
  ) => Promise<{ origin: string; deploymentId: string }>;
  verify: typeof verifyDeployment;
}
export async function runPublication(
  adapter: WorkerAdapter,
  hosting: HostingAdapter,
  job: Job,
  sourceCommit: string,
  build = buildPortalCandidate,
) {
  let activationPossible = false;
  try {
    const subject = await adapter.rpc<{
      manifest: PortalManifest;
      digest: string;
      approvedAt: string;
      approvedBy: string;
    }>('worker_subject', { p_job: job.jobId, p_attempt: job.attemptId });
    const m = subject.manifest;
    if (
      m.sourceCommit !== sourceCommit ||
      m.environment !== hosting.environment ||
      !m.targetOrigin ||
      !m.targetId ||
      m.targetOrigin !== hosting.canonicalOrigin ||
      m.targetId !== hosting.targetId
    )
      throw new ContentError('RELEASE_TARGET_OR_SOURCE_MISMATCH');
    const candidate = await build(adapter, m, subject);
    const staged = await hosting.candidate(candidate.site);
    await hosting.verify({
      schemaVersion: 1,
      revision: candidate.snapshot.revision,
      origin: staged.origin,
      files: candidate.files,
    });
    await adapter.rpc('worker_activation_check', {
      p_job: job.jobId,
      p_attempt: job.attemptId,
    });
    // This flag precedes the request: a lost response may still have activated it.
    activationPossible = true;
    const deployed = await hosting.production(candidate.site);
    await adapter.rpc('worker_record_deployment', {
      p_job: job.jobId,
      p_attempt: job.attemptId,
      p_receipt: {
        deploymentId: deployed.deploymentId,
        origin: deployed.origin,
      },
    });
    await hosting.verify({
      schemaVersion: 1,
      revision: candidate.snapshot.revision,
      origin: deployed.origin,
      files: candidate.files,
    });
    const verified = await hosting.verify({
      schemaVersion: 1,
      revision: candidate.snapshot.revision,
      origin: m.targetOrigin,
      files: candidate.files,
    });
    await adapter.rpc('worker_verified', {
      p_job: job.jobId,
      p_attempt: job.attemptId,
      p_manifest_digest: subject.digest,
      p_receipt: {
        verified: true,
        origin: m.targetOrigin,
        contentRevision: candidate.snapshot.revision,
        artifactHash: candidate.artifactHash,
        deploymentId: deployed.deploymentId,
        verifiedAt: verified.verifiedAt,
      },
    });
  } catch (error) {
    await adapter.rpc('worker_fail', {
      p_job: job.jobId,
      p_attempt: job.attemptId,
      p_code: error instanceof ContentError ? error.code : 'PUBLICATION_FAILED',
      p_activation_possible: activationPossible,
    });
    throw error;
  }
}
async function command(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(file, args, {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      if (output.length < 200000) output += chunk;
    });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => {
      child.kill();
      fail(new ContentError('HOSTING_TIMEOUT'));
    }, 300000);
    child.on('error', () => {
      clearTimeout(timer);
      fail(new ContentError('HOSTING_COMMAND_FAILED'));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      code === 0
        ? done(output)
        : fail(new ContentError('HOSTING_COMMAND_FAILED'));
    });
  });
}
export function cloudflareHosting(
  env: NodeJS.ProcessEnv = process.env,
): HostingAdapter {
  const project = env.CREATECH_PAGES_PROJECT,
    account = env.CLOUDFLARE_ACCOUNT_ID,
    token = env.CLOUDFLARE_API_TOKEN;
  if (
    !project ||
    !/^[a-z0-9-]+$/.test(project) ||
    !account ||
    !/^[a-f0-9]{32}$/.test(account) ||
    !token ||
    env.CREATECH_HOSTING_ENABLED !== 'true'
  )
    throw new ContentError('HOSTING_NOT_AUTHORISED');
  const deploy = async (directory: string, branch: string) => {
    const isolated: NodeJS.ProcessEnv = {
      PATH: env.PATH,
      SystemRoot: env.SystemRoot,
      HOME: env.HOME,
      USERPROFILE: env.USERPROFILE,
      TEMP: env.TEMP,
      TMP: env.TMP,
      CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_API_TOKEN: token,
      CI: 'true',
      WRANGLER_SEND_METRICS: 'false',
    };
    const output = await command(
      process.execPath,
      [
        resolve('node_modules/wrangler/bin/wrangler.js'),
        'pages',
        'deploy',
        directory,
        '--project-name',
        project,
        '--branch',
        branch,
        '--commit-dirty=true',
      ],
      isolated,
    );
    const match = output.match(
      /https:\/\/([a-z0-9]+)\.([a-z0-9-]+)\.pages\.dev/,
    );
    if (!match || match[2] !== project)
      throw new ContentError('DEPLOYMENT_ID_NOT_OBSERVED');
    return { origin: `${match[0]}/`, deploymentId: match[1] };
  };
  if (
    !env.CREATECH_CANONICAL_ORIGIN ||
    env.CREATECH_CANDIDATE_PROTECTION_VERIFIED !== 'true'
  )
    throw new ContentError('CANDIDATE_PROTECTION_NOT_VERIFIED');
  if (!['staging', 'production'].includes(env.PORTAL_ENVIRONMENT || ''))
    throw new ContentError('HOSTING_ENVIRONMENT_INVALID');
  return {
    targetId: project,
    canonicalOrigin: env.CREATECH_CANONICAL_ORIGIN,
    environment: env.PORTAL_ENVIRONMENT as 'staging' | 'production',
    candidate: (d) => deploy(d, 'candidate'),
    production: (d) => deploy(d, env.CREATECH_PRODUCTION_BRANCH || 'main'),
    verify: (value, fetcher = fetch) =>
      verifyDeployment(value, async (input, init) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        if (
          (url.hostname === `${project}.pages.dev` ||
            url.hostname.endsWith(`.${project}.pages.dev`)) &&
          env.CF_ACCESS_CLIENT_ID &&
          env.CF_ACCESS_CLIENT_SECRET
        ) {
          headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
          headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
        }
        return fetcher(input, { ...init, headers });
      }),
  };
}
async function main() {
  const id = process.argv[2];
  if (!id || !/^[a-f0-9-]{36}$/.test(id))
    throw new ContentError('JOB_ID_REQUIRED');
  const source = process.env.REVIEWED_SOURCE_COMMIT;
  if (!source || !/^[a-f0-9]{40}$/.test(source))
    throw new ContentError('SOURCE_COMMIT_REQUIRED');
  const checkout = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const changes = spawnSync(
    'git',
    ['status', '--porcelain', '--untracked-files=normal'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (
    checkout.status !== 0 ||
    checkout.stdout.trim() !== source ||
    changes.status !== 0 ||
    changes.stdout.trim()
  )
    throw new ContentError('CLEAN_REVIEWED_CHECKOUT_REQUIRED');
  const adapter = workerAdapter();
  const job = await adapter.rpc<Job | null>('worker_claim', {
    p_job: id,
    p_run: process.env.GITHUB_RUN_ID || `local-${randomUUID()}`,
  });
  if (!job) {
    process.stdout.write('No eligible job claimed.\n');
    return;
  }
  let heartbeatFailed = false;
  const heartbeat = setInterval(() => {
    void adapter
      .rpc('worker_heartbeat', { p_job: id, p_attempt: job.attemptId })
      .catch(() => {
        heartbeatFailed = true;
      });
  }, 60000);
  try {
    if (job.kind === 'validate') await runValidation(adapter, job, source);
    else {
      let hosting: HostingAdapter;
      try {
        hosting = cloudflareHosting();
      } catch (error) {
        await adapter.rpc('worker_fail', {
          p_job: id,
          p_attempt: job.attemptId,
          p_code: 'HOSTING_CONFIGURATION_REQUIRED',
          p_activation_possible: false,
        });
        throw error;
      }
      await runPublication(
        adapter,
        {
          ...hosting,
          production: async (d) => {
            if (heartbeatFailed) throw new ContentError('WORKER_LEASE_LOST');
            return hosting.production(d);
          },
        },
        job,
        source,
      );
    }
    process.stdout.write('Job completed and receipt recorded.\n');
  } catch (error) {
    if (job.kind === 'validate')
      await adapter
        .rpc('worker_fail', {
          p_job: id,
          p_attempt: job.attemptId,
          p_code:
            error instanceof ContentError ? error.code : 'VALIDATION_FAILED',
          p_activation_possible: false,
        })
        .catch(() => {});
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof ContentError ? error.code : 'WORKER_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
