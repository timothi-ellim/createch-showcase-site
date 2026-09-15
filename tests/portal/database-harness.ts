import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
export const A = '00000000-0000-4000-8000-000000000001',
  B = '00000000-0000-4000-8000-000000000002',
  O = '00000000-0000-4000-8000-000000000003',
  U = '00000000-0000-4000-8000-000000000004';
export const PA = '10000000-0000-4000-8000-000000000001',
  PB = '10000000-0000-4000-8000-000000000002';
// Real PostgreSQL execution in WASM. These auth/storage shims provide SQL
// identities only; this suite does NOT claim JWT, Auth, HTTP or Storage API proof.
export async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,invited_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text, unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon;
    grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const name of (await readdir('supabase/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    try {
      await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
    } catch (error) {
      await db.close();
      throw new Error(`${name}: ${(error as Error).message}`);
    }
  }
  const event = JSON.parse(await readFile('content/event.json', 'utf8'));
  const data = JSON.parse(await readFile('content/projects.json', 'utf8'));
  await db.exec(`insert into auth.users(id) values('${A}'),('${B}'),('${O}'),('${U}');
    insert into editorial.settings(environment) values('local');
    insert into editorial.event_roles values('${O}','owner',true);
    insert into editorial.projects(id,public_id,slug) values('${PA}','fixture-01','sample-image-study'),('${PB}','fixture-02','sample-world-study');
    insert into editorial.memberships(project_id,user_id) values('${PA}','${A}'),('${PB}','${B}');
    insert into editorial.drafts(project_id) values('${PA}'),('${PB}');
    insert into editorial.reviewed_sources(commit_sha) values('${'a'.repeat(40)}');`);
  // The fixture format is read from the same canonical content files.
  await db.query(
    'insert into editorial.event_configs(config,themes) values($1,$2)',
    [event, data.themes],
  );
  for (const p of [PA, PB])
    await db.query(
      'insert into editorial.metadata_versions(project_id,version,fields) values($1,1,$2)',
      [
        p,
        {
          theme: 'image',
          room: null,
          duration: null,
          schedule: null,
          accessNotes: null,
          relatedIds: [],
        },
      ],
    );
  return db;
}
export async function asUser(
  db: PGlite,
  user: string | null,
  role = 'authenticated',
  aal = 'aal1',
) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: user, role, aal }),
  ]);
  if (!['authenticated', 'anon', 'service_role'].includes(role))
    throw new Error('Invalid test role');
  await db.exec(`set role ${role}`);
}
export const fields = {
  title: 'Synthetic test work',
  maker: 'Synthetic contributor',
  invitation: 'Explore a synthetic example.',
  description: 'Fixture for local development.',
  visitorAction: 'Look at the test example.',
  encounters: ['Look / listen'],
  assetId: null,
  alt: '',
  credit: '',
  links: [],
  videoUrl: null,
  processNote: '',
  accessProposal: '',
  permission: true,
  termsVersion: 'public-profile-v1',
};
export async function rpc<T = any>(
  db: PGlite,
  name: string,
  args: unknown[] = [],
): Promise<T> {
  if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid test routine');
  const result = await db.query<{ result: T }>(
    `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`,
    args,
  );
  return result.rows[0].result;
}
