import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  realpath,
  lstat,
} from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ContentError } from '../src/lib/content-schema.ts';

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
export function defaultStoreRoot() {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'),
    'CreaTechShowcase',
    'editorial-pilot',
  );
}
export async function ensureStoreRoot(value = defaultStoreRoot()) {
  const root = resolve(value);
  const relation = relative(repositoryRoot, root);
  if (!relation || (!relation.startsWith('..') && !isAbsolute(relation)))
    throw new ContentError('PRIVATE_STORE_MUST_BE_OUTSIDE_REPOSITORY');
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink())
    throw new ContentError('STORE_SYMLINK_NOT_ALLOWED');
  const actual = await realpath(root);
  const actualRelation = relative(await realpath(repositoryRoot), actual);
  if (
    !actualRelation ||
    (!actualRelation.startsWith('..') && !isAbsolute(actualRelation))
  )
    throw new ContentError('PRIVATE_STORE_MUST_BE_OUTSIDE_REPOSITORY');
  // Windows packaged apps virtualise LOCALAPPDATA. Use the resolved private root
  // consistently instead of assuming its parent directories have literal paths.
  return actual;
}
export async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
export async function readJson(path: string): Promise<unknown> {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink() || file.size > 20_000_000)
    throw new ContentError('INVALID_STORE_FILE');
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new ContentError('UNREADABLE_JSON');
  }
}
export async function withStoreLock<T>(
  root: string,
  operation: () => Promise<T>,
) {
  await ensureStoreRoot(root);
  const lockPath = join(root, '.writer.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new ContentError('EDITORIAL_BUSY', [
      'another writer or stale lock; see runbook',
    ]);
  });
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await operation();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
export function within(root: string, segment: string) {
  const path = resolve(root, segment);
  const relation = relative(resolve(root), path);
  if (!relation || relation.startsWith('..') || isAbsolute(relation))
    throw new ContentError('PATH_OUTSIDE_ROOT');
  return path;
}
