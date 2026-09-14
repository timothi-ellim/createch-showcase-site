import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  copyFile,
  lstat,
  realpath,
} from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  ContentError,
  readSnapshot,
  digest,
} from '../src/lib/content-schema.ts';
import type { PublicSnapshot } from '../src/lib/content-schema.ts';
import { atomicJson, readJson, repositoryRoot, within } from './store.ts';

export interface FileDigest {
  path: string;
  sha256: string;
  size: number;
}
export interface Release {
  sourceHash?: string;
  revision: string;
  artifactHash: string;
  directory: string;
  verifiedAt: string;
  files: FileDigest[];
}
export interface LivePointer {
  schemaVersion: 1;
  active: Release;
  previous: Release[];
}
export async function inventory(
  root: string,
  prefix = '',
): Promise<FileDigest[]> {
  const output: FileDigest[] = [];
  for (const item of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink())
      throw new ContentError('SYMLINK_IN_PUBLIC_OUTPUT');
    if (item.isDirectory()) output.push(...(await inventory(root, path)));
    else if (item.isFile()) {
      const buffer = await readFile(join(root, path));
      output.push({
        path,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        size: buffer.length,
      });
    } else throw new ContentError('INVALID_PUBLIC_FILE');
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}
export function ensureBuildPath(value: string) {
  const base = resolve(repositoryRoot, '.build-candidates');
  const path = resolve(value);
  const suffix = relative(base, path);
  if (!/^[a-z0-9-]+[\\/]site$/.test(suffix))
    throw new ContentError('UNSAFE_BUILD_DIRECTORY');
  return path;
}
export async function runAstroBuild(
  snapshotPath: string,
  outDir: string,
  mode: 'editorial-preview' | 'production' = 'editorial-preview',
  receiptPath?: string,
) {
  ensureBuildPath(outDir);
  await mkdir(outDir, { recursive: true });
  if ((await realpath(outDir)).toLowerCase() !== resolve(outDir).toLowerCase())
    throw new ContentError('BUILD_SYMLINK_NOT_ALLOWED');
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'PUBLIC_PORTAL_ENVIRONMENT',
  ])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    ASTRO_TELEMETRY_DISABLED: '1',
    CREATECH_SNAPSHOT: snapshotPath,
    CREATECH_BUILD_DIR: outDir,
    CREATECH_RELEASE_APPROVAL: receiptPath ?? '',
  });
  return await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(repositoryRoot, 'node_modules/astro/bin/astro.mjs'),
        'build',
        '--mode',
        mode,
      ],
      {
        cwd: repositoryRoot,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let log = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new ContentError('BUILD_TIMEOUT'));
    }, 120_000);
    const collect = (chunk: Buffer) => {
      if (log.length < 2_000_000) log += chunk.toString();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new ContentError('BUILD_COULD_NOT_START'));
    });
    child.on('exit', async (code) => {
      clearTimeout(timer);
      // All inputs are validated public snapshots. Build output never includes the
      // private store or connector token. Store diagnostics outside the served tree.
      try {
        await writeFile(join(resolve(outDir, '..'), 'build.log'), log, {
          mode: 0o600,
        });
        if (code === 0) resolveBuild();
        else reject(new ContentError('BUILD_FAILED', ['candidate build.log']));
      } catch {
        reject(new ContentError('BUILD_LOG_FAILED'));
      }
    });
  });
}
export async function verifyOutput(
  directory: string,
  snapshot: PublicSnapshot,
  privateValues: string[] = [],
) {
  const manifest = (await readJson(
    join(directory, 'content-revision.json'),
  )) as { revision?: string; projectIds?: string[] };
  if (
    manifest.revision !== snapshot.revision ||
    JSON.stringify(manifest.projectIds) !==
      JSON.stringify(snapshot.projects.map((project) => project.id))
  )
    throw new ContentError('BUILT_REVISION_MISMATCH');
  const files = await inventory(directory);
  const fileNames = new Set(files.map((file) => file.path));
  for (const project of snapshot.projects) {
    if (!fileNames.has(`projects/${project.slug}/index.html`))
      throw new ContentError('PROJECT_ROUTE_MISSING');
    for (const media of [project.media, ...project.processMedia])
      if (media && !fileNames.has(media.src.slice(1)))
        throw new ContentError('PUBLIC_MEDIA_MISSING');
  }
  const expected = new Set(
    snapshot.projects.map((project) => `projects/${project.slug}/index.html`),
  );
  for (const file of files) {
    if (
      file.path.startsWith('projects/') &&
      file.path.endsWith('.html') &&
      !expected.has(file.path)
    )
      throw new ContentError('UNEXPECTED_PROJECT_ROUTE');
    if (
      /\.(?:map|ts|gs)$|(?:^|\/)(?:docs|reference|editorial|state\.json|\.git|\.env)(?:\/|$)/i.test(
        file.path,
      )
    )
      throw new ContentError('PRIVATE_FILE_IN_OUTPUT');
    if (/\.(?:html|js|json|css|txt)$/.test(file.path)) {
      const text = await readFile(join(directory, file.path), 'utf8');
      if (
        file.path.endsWith('.html') &&
        !text.includes(
          `<meta name="createch-revision" content="${snapshot.revision}"`,
        )
      )
        throw new ContentError('PAGE_REVISION_MISMATCH', [file.path]);
      if (
        /edit2=|editLinkSecret|ownerContact|responseId|7 August|September 2026/i.test(
          text,
        )
      )
        throw new ContentError('PRIVATE_OR_STALE_MARKER_IN_OUTPUT');
      if (
        privateValues.some(
          (value) =>
            value.length >= 6 &&
            text.toLowerCase().includes(value.toLowerCase()),
        )
      )
        throw new ContentError('PRIVATE_VALUE_IN_OUTPUT');
    }
  }
  return { files, artifactHash: digest(files) };
}
export async function publishLocal(
  root: string,
  snapshotValue: unknown,
  options: {
    build?: typeof runAstroBuild;
    privateValues?: string[];
    mediaRoot?: string;
  } = {},
) {
  const snapshot = readSnapshot(snapshotValue);
  const sourceFiles = await Promise.all(
    ['src', 'public'].map(async (name) =>
      (await inventory(join(repositoryRoot, name))).map((file) => ({
        ...file,
        path: `${name}/${file.path}`,
      })),
    ),
  );
  const configuration = await Promise.all(
    ['astro.config.mjs', 'package.json', 'package-lock.json'].map(
      async (path) => ({
        path,
        sha256: createHash('sha256')
          .update(await readFile(join(repositoryRoot, path)))
          .digest('hex'),
      }),
    ),
  );
  const sourceHash = digest([...sourceFiles.flat(), ...configuration]);
  if (snapshot.publicationStatus !== 'synthetic-local-only')
    throw new ContentError('LOCAL_PILOT_ACCEPTS_SYNTHETIC_ONLY');
  let pointer: LivePointer | null = null;
  try {
    pointer = (await readJson(join(root, 'live.json'))) as LivePointer;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (
    pointer?.active.revision === snapshot.revision &&
    pointer.active.sourceHash === sourceHash
  ) {
    await verifyRelease(root, pointer.active);
    return { outcome: 'unchanged', release: pointer.active };
  }
  const candidate = join(repositoryRoot, '.build-candidates', randomUUID());
  const outDir = join(candidate, 'site');
  await mkdir(candidate, { recursive: true });
  const input = join(candidate, 'snapshot.json');
  await atomicJson(input, snapshot);
  await (options.build ?? runAstroBuild)(input, outDir);
  if (options.mediaRoot)
    await copyApprovedMedia(snapshot, options.mediaRoot, outDir);
  const verified = await verifyOutput(outDir, snapshot, options.privateValues);
  const directoryName = `${snapshot.revision.slice(0, 16)}-${verified.artifactHash.slice(0, 16)}`;
  const releaseDir = join(root, 'publications', directoryName);
  const release: Release = {
    sourceHash,
    revision: snapshot.revision,
    artifactHash: verified.artifactHash,
    directory: directoryName,
    verifiedAt: new Date().toISOString(),
    files: verified.files,
  };
  await mkdir(join(root, 'publications'), { recursive: true });
  let existing = false;
  try {
    await mkdir(releaseDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    existing = true;
  }
  // Never overwrite a generation, including a corrupt or incomplete one.
  if (!existing)
    for (const file of verified.files) {
      const destination = within(releaseDir, file.path);
      await mkdir(resolve(destination, '..'), { recursive: true });
      await copyFile(join(outDir, file.path), destination);
    }
  await verifyRelease(root, release);
  const previous = pointer
    ? [pointer.active, ...pointer.previous]
        .filter(
          (item, index, all) =>
            all.findIndex((other) => other.directory === item.directory) ===
            index,
        )
        .slice(0, 20)
    : [];
  await atomicJson(join(root, 'live.json'), {
    schemaVersion: 1,
    active: release,
    previous,
  } satisfies LivePointer);
  return { outcome: 'local-revision-activated', release };
}
export async function copyApprovedMedia(
  snapshot: PublicSnapshot,
  mediaRoot: string,
  outDir: string,
) {
  const media = new Map(
    snapshot.projects
      .flatMap((project) => [project.media, ...project.processMedia])
      .filter((item) => item !== null)
      .map((item) => [item.src, item]),
  );
  for (const [src] of media) {
    const source = within(mediaRoot, src.slice('/media/'.length));
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new ContentError('INVALID_MEDIA_FILE');
    const bytes = await readFile(source);
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      src.split('/').at(-1)!.split('.')[0]
    )
      throw new ContentError('MEDIA_HASH_MISMATCH');
    await mkdir(join(outDir, 'media'), { recursive: true });
    await copyFile(source, join(outDir, src.slice(1)));
  }
}
export async function verifyRelease(root: string, release: Release) {
  if (!/^[a-f0-9]{16}-[a-f0-9]{16}$/.test(release.directory))
    throw new ContentError('INVALID_RELEASE_DIRECTORY');
  const directory = within(join(root, 'publications'), release.directory);
  if (
    (await realpath(directory)).toLowerCase() !==
    resolve(directory).toLowerCase()
  )
    throw new ContentError('RELEASE_SYMLINK_NOT_ALLOWED');
  const files = await inventory(directory);
  if (digest(files) !== release.artifactHash)
    throw new ContentError('RELEASE_FILES_CHANGED');
  const manifest = (await readJson(
    join(directory, 'content-revision.json'),
  )) as { revision: string };
  if (manifest.revision !== release.revision)
    throw new ContentError('RELEASE_REVISION_MISMATCH');
  return directory;
}
export async function rollbackLocal(root: string, artifactHash: string) {
  const pointer = (await readJson(join(root, 'live.json'))) as LivePointer;
  const target = pointer.previous.find(
    (release) => release.artifactHash === artifactHash,
  );
  if (!target) throw new ContentError('ROLLBACK_TARGET_NOT_FOUND');
  await verifyRelease(root, target);
  const next: LivePointer = {
    schemaVersion: 1,
    active: target,
    previous: [
      pointer.active,
      ...pointer.previous.filter(
        (release) => release.directory !== target.directory,
      ),
    ],
  };
  await atomicJson(join(root, 'live.json'), next);
  return target;
}
