import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { checkPortalEnvironment } from '../src/lib/portal-contract.ts';

// Local Supabase status is parsed in memory. Never print provider keys.
const status = spawnSync(
  process.execPath,
  ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'],
  { encoding: 'utf8', windowsHide: true },
);
if (status.status !== 0) {
  process.stderr.write(
    'LOCAL_SUPABASE_UNAVAILABLE: start the Docker Linux engine and the isolated Supabase stack first.\n',
  );
  process.exit(1);
}
const settings: Record<string, string> = {};
for (const line of status.stdout.split('\n')) {
  const match = line.match(/^([A-Z_]+)="?(.*?)"?\r?$/);
  if (match) settings[match[1]] = match[2].replace(/"$/, '');
}
const url = settings.API_URL,
  key = settings.SERVICE_ROLE_KEY || settings.SECRET_KEY;
if (!url || !key) {
  process.stderr.write('LOCAL_STATUS_CONFIGURATION_MISSING\n');
  process.exit(1);
}
checkPortalEnvironment(url, 'local', 'http://127.0.0.1:4321');
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function main() {
  const command = process.argv[2] || 'status';
  if (command === 'status') {
    process.stdout.write('Local Supabase available. Keys were not printed.\n');
    return;
  }
  if (command !== 'seed') throw new Error('Use status or seed.');
  const existing = spawnSync(
    'docker',
    [
      'exec',
      'supabase_db_createch-showcase-local',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-Atc',
      'select count(*) from editorial.projects;',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (existing.status !== 0 || existing.stdout.trim() !== '0')
    throw new Error('EMPTY_LOCAL_STORE_REQUIRED: existing records preserved.');
  const root = join(tmpdir(), 'createch-supabase-local');
  await mkdir(root, { recursive: true });
  const journal = join(root, 'seed.private.json');
  try {
    await readFile(journal);
    throw new Error(
      'LOCAL_SEED_ALREADY_ATTEMPTED: inspect the private journal before retrying.',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeFile(
    journal,
    JSON.stringify({ state: 'started', at: new Date().toISOString() }),
    { flag: 'wx', mode: 0o600 },
  );
  const event = JSON.parse(await readFile('content/event.json', 'utf8')),
    catalogue = JSON.parse(await readFile('content/projects.json', 'utf8'));
  const source = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.trim();
  const users: { id: string; label: string; email: string }[] = [];
  for (const label of ['participant-a', 'participant-b', 'organiser']) {
    const email = `${label}-${randomUUID().slice(0, 8)}@example.invalid`;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error || !data.user) throw new Error('LOCAL_ACCOUNT_SETUP_UNCONFIRMED');
    users.push({ id: data.user.id, label, email });
    await writeFile(journal, JSON.stringify({ state: 'creating', users }), {
      mode: 0o600,
    });
  }
  const projects = catalogue.projects.slice(0, 2).map((p: any, i: number) => ({
    publicId: p.id,
    slug: p.slug,
    userId: users[i].id,
    metadata: {
      theme: p.theme,
      room: null,
      schedule: null,
      duration: null,
      accessNotes: null,
      relatedIds: [],
    },
    fields: {
      title: p.title,
      maker: p.maker,
      invitation: p.invitation.slice(0, 200),
      description: p.description.slice(0, 2000),
      visitorAction: p.visitorAction.slice(0, 700),
      encounters: p.encounters,
      assetId: null,
      alt: '',
      credit: '',
      links: [],
      videoUrl: null,
      processNote: '',
      accessProposal: '',
      permission: true,
      termsVersion: 'public-profile-v1',
    },
  }));
  const result = await admin.rpc('worker_seed_local', {
    p_event: event,
    p_themes: catalogue.themes,
    p_projects: projects,
    p_owner: users[2].id,
    p_source: source,
  });
  if (result.error) throw new Error('LOCAL_SEED_UNCONFIRMED');
  await writeFile(journal, JSON.stringify({ state: 'seeded', users, source }), {
    mode: 0o600,
  });
  process.stdout.write(
    `Created two synthetic contributors and one unconfirmed organiser. No real email sent. Local identity journal: ${resolve(journal)}\nUse the local mail capture to verify actual sign-in and enrol organiser MFA.\n`,
  );
}
void main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
