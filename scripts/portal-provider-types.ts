import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { localRuntime } from './portal-local-runtime.ts';
import { database } from '../tests/portal/database-harness.ts';
localRuntime(); // Never generate from an implicit remote project.
const result = spawnSync(
  process.execPath,
  [
    'node_modules/supabase/dist/supabase.js',
    'gen',
    'types',
    'typescript',
    '--local',
    '--schema',
    'public',
    '--network-id',
    'createch-local-loopback',
  ],
  { encoding: 'utf8', windowsHide: true },
);
if (result.status !== 0)
  throw new Error('LOCAL_PROVIDER_TYPE_GENERATION_FAILED');
const start = result.stdout.indexOf('export type Json =');
if (start < 0) throw new Error('UNEXPECTED_PROVIDER_TYPES');
const output = result.stdout.slice(start);
const names = (text: string) =>
  [...text.matchAll(/^\s{2,6}([a-z_]+): \{/gm)]
    .map((m) => m[1])
    .filter((n) => !['public', '__InternalSupabase'].includes(n));
const db = await database();
let expected: string[];
try {
  const functions = await db.query<{ name: string }>(
    "select p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname",
  );
  expected = functions.rows.map((row) => row.name);
} finally {
  await db.close();
}
const actual = names(output).sort();
assert.deepEqual(
  actual,
  expected,
  'Real Supabase and migration-derived RPC names disagree',
);
await writeFile(
  'src/lib/portal-database.generated.ts',
  '// Generated from the real local Supabase schema by scripts/portal-provider-types.ts.\n' +
    output,
);
await writeFile(
  'docs/evidence/portal/provider-schema.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      result: 'passed',
      rpcCount: actual.length,
      generator: 'Supabase CLI 2.117.0 against local PostgreSQL 17.6',
      comparison:
        'RPC names agree with independently executed PGlite migrations',
      network: 'createch-local-loopback',
      notProven: 'Cloud project schema has not been configured',
    },
    null,
    2,
  ),
);
process.stdout.write(
  `Real Supabase generated ${actual.length} RPC definitions; migration-derived names agree.\n`,
);
