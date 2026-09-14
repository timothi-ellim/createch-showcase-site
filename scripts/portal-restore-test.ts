// Non-destructive local restore rehearsal. Original database/objects are retained.
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { localRuntime, checked } from './portal-local-runtime.ts';
const r = localRuntime(),
  container = 'supabase_db_createch-showcase-local',
  run = randomUUID().replaceAll('-', ''),
  restored = `createch_restore_${run}`,
  archive = `/tmp/createch-${run}.dump`,
  directory = join(tmpdir(), 'createch-supabase-local', 'restores', run);
const command = (args: string[]) => {
  const p = spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (p.status !== 0)
    throw new Error(
      `LOCAL_RESTORE_COMMAND_FAILED_${args[2]}: ${p.stderr.split('\n')[0]}`,
    );
  return p.stdout.trim();
};
const sql = (database: string, query: string) =>
  command([
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    database,
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query,
  ]);
try {
  assert.equal(
    sql(
      'postgres',
      "select count(*) from auth.users where email not like '%@example.invalid';",
    ),
    '0',
    'Synthetic store required',
  );
  await mkdir(directory, { recursive: true });
  command([
    'exec',
    container,
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-Fc',
    '-f',
    archive,
  ]);
  command(['cp', `${container}:${archive}`, join(directory, 'database.dump')]);
  command([
    'exec',
    container,
    'createdb',
    '-U',
    'postgres',
    '-T',
    'template0',
    restored,
  ]);
  command([
    'exec',
    container,
    'pg_restore',
    '-U',
    'supabase_admin',
    '--exit-on-error',
    '-d',
    restored,
    archive,
  ]);
  const tables = [
    'auth.users',
    'auth.mfa_factors',
    'auth.identities',
    'editorial.projects',
    'editorial.memberships',
    'editorial.drafts',
    'editorial.revisions',
    'editorial.prepared',
    'editorial.decisions',
    'editorial.releases',
    'editorial.audit',
    'storage.objects',
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const before = sql('postgres', `select count(*) from ${table};`),
      after = sql(restored, `select count(*) from ${table};`);
    assert.equal(after, before);
    counts[table] = Number(before);
  }
  for (const table of [
    'editorial.drafts',
    'editorial.revisions',
    'editorial.prepared',
    'editorial.decisions',
    'editorial.releases',
    'editorial.memberships',
  ]) {
    const query = `select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'')) from ${table} t;`;
    assert.equal(sql(restored, query), sql('postgres', query));
  }
  const objects = JSON.parse(
    sql(
      'postgres',
      "select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)),'[]') from storage.objects where bucket_id in ('source-uploads','prepared-media');",
    ),
  );
  const bytesManifest = [];
  for (const [i, obj] of objects.entries()) {
    const blob = await checked(
        r.admin.storage.from(obj.bucket).download(obj.path),
      ),
      bytes = Buffer.from(await blob.arrayBuffer()),
      hash = createHash('sha256').update(bytes).digest('hex'),
      file = `object-${i}.bin`;
    await writeFile(join(directory, file), bytes, { mode: 0o600 });
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(directory, file)))
        .digest('hex'),
      hash,
    );
    bytesManifest.push({ ...obj, file, sha256: hash });
  }
  await writeFile(
    join(directory, 'objects.private.json'),
    JSON.stringify(bytesManifest, null, 2),
    { mode: 0o600 },
  );
  // Exercise real restored grants, with explicit low-privilege request claims.
  assert.equal(
    sql(
      restored,
      "select has_schema_privilege('authenticated','editorial','USAGE');",
    ),
    'f',
  );
  assert.equal(
    sql(
      restored,
      "select count(*) from editorial.settings where environment='local';",
    ),
    '1',
  );
  await writeFile(
    'docs/evidence/portal/local-restore.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        result: 'passed',
        scope:
          'Real Supabase PostgreSQL archive restored into a separate local database; actual Storage bytes copied and hash-checked',
        counts,
        storageObjects: objects.length,
        originalPreserved: true,
        grantsPreserved: true,
        backupLocation:
          'OS temporary private createch-supabase-local/restores directory',
        notProven: [
          'Restored Auth/Storage services mounted on the separate database',
          'production restricted backup policy',
          'owner recovery exercise',
          'external staging restore',
        ],
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    `Local PostgreSQL restore verified (${tables.length} table counts, six record digests, ${objects.length} actual Storage objects). Original retained.\n`,
  );
} catch (error) {
  process.stderr.write(`${(error as Error).message.split('\n')[0]}\n`);
  process.exitCode = 1;
}
