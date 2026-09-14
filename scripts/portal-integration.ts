// Real local Supabase HTTP/Auth/Storage probe. Destructive resets are deliberately
// absent. Requires an empty, migrated local store; never accepts a remote URL.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { checkPortalEnvironment } from '../src/lib/portal-contract.ts';

const cli = spawnSync(
  process.execPath,
  ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'],
  { encoding: 'utf8', windowsHide: true },
);
if (cli.status !== 0) {
  process.stderr.write(
    'BLOCKED: LOCAL_SUPABASE_UNAVAILABLE. No integration assertions ran.\n',
  );
  process.exit(1);
}
const settings: Record<string, string> = {};
for (const line of cli.stdout.split('\n')) {
  const match = line.match(/^([A-Z_]+)="?(.*?)"?\r?$/);
  if (match) settings[match[1]] = match[2].replace(/"$/, '');
}
const url = settings.API_URL,
  key = settings.SERVICE_ROLE_KEY || settings.SECRET_KEY,
  pub = settings.ANON_KEY || settings.PUBLISHABLE_KEY;
checkPortalEnvironment(url, 'local', 'http://127.0.0.1:4321');
assert.ok(key && pub);
const client = (secret = pub) =>
    createClient(url, secret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  admin = client(key);
const ok = async (promise: PromiseLike<any>) => {
  const result = await promise;
  if (result.error)
    throw new Error(
      `INTEGRATION_REQUEST_FAILED:${String(result.error.code || result.error.status || 'unknown').replace(/[^A-Za-z0-9_-]/g, '')}`,
    );
  return result.data;
};
let phase = 'startup';
const journalDirectory = join(tmpdir(), 'createch-supabase-local');
const journalPath = join(journalDirectory, 'integration.private.json');
const record: {
  users: { id: string; email: string }[];
  projects?: string[];
  submission?: unknown;
  ownerFactor?: { id: string; totp: { secret: string } };
} = await readFile(journalPath, 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === 'ENOENT') return { users: [] };
    throw error;
  });
const saveJournal = async () => {
  await mkdir(journalDirectory, { recursive: true });
  await writeFile(journalPath, JSON.stringify(record), { mode: 0o600 });
};
const denied = async (promise: PromiseLike<any>) =>
  assert.ok((await promise).error, 'Expected denied HTTP request');
function totp(secret: string) {
  let bits = '';
  for (const c of secret.toUpperCase().replace(/=+$/, ''))
    bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
      .indexOf(c)
      .toString(2)
      .padStart(5, '0');
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)),
  );
  const step = Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', bytes).update(step).digest(),
    offset = hash.at(-1)! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    '0',
  );
}
async function main() {
  const marker = await ok(admin.rpc('worker_queued'));
  assert.ok(Array.isArray(marker));
  // Seed RPC independently rejects populated/nonlocal stores. Do not reset them.
  const users: {
    id: string;
    email: string;
    session: ReturnType<typeof client>;
  }[] = [];
  for (const name of ['a', 'b', 'owner', 'unassigned']) {
    phase = `authenticate-${name}`;
    let existing = record.users[users.length];
    if (!existing) {
      const email = `portal-integration-${name}-${randomUUID()}@example.invalid`;
      const data = await ok(
        admin.auth.admin.createUser({ email, email_confirm: false }),
      );
      existing = { id: data.user.id, email };
      record.users.push(existing);
      await saveJournal();
    }
    const { email } = existing;
    assert.ok(
      email.startsWith('portal-integration-') &&
        email.endsWith('@example.invalid'),
    );
    const session = client();
    // Local test-only admin token generation proves code verification, not delivery.
    const link = await ok(
      admin.auth.admin.generateLink({ type: 'magiclink', email }),
    );
    const code = link.properties.email_otp;
    await denied(
      session.auth.verifyOtp({ email, token: '00000000', type: 'email' }),
    );
    await ok(session.auth.verifyOtp({ email, token: code, type: 'email' }));
    await denied(
      client().auth.verifyOtp({ email, token: code, type: 'email' }),
    );
    users.push({ id: existing.id, email, session });
  }
  phase = 'seed';
  const event = JSON.parse(await readFile('content/event.json', 'utf8')),
    catalogue = JSON.parse(await readFile('content/projects.json', 'utf8'));
  if (!(await ok(users[2].session.rpc('portal_context'))).owner)
    await ok(
      admin.rpc('worker_seed_local', {
        p_event: event,
        p_themes: catalogue.themes,
        p_owner: users[2].id,
        p_source: 'a'.repeat(40),
        p_projects: catalogue.projects.slice(0, 2).map((p: any, i: number) => ({
          publicId: p.id,
          slug: p.slug,
          userId: users[i].id,
          metadata: {
            theme: p.theme,
            room: null,
            duration: null,
            schedule: null,
            accessNotes: null,
            relatedIds: [],
          },
          fields: {
            title: p.title,
            maker: p.maker,
            invitation: p.invitation.slice(0, 200),
            description: p.description,
            visitorAction: p.visitorAction,
            encounters: p.encounters,
            links: [],
            videoUrl: null,
            assetId: null,
            alt: '',
            credit: '',
            processNote: '',
            accessProposal: '',
            permission: true,
            termsVersion: 'public-profile-v1',
          },
        })),
      }),
    );
  const [a, b, owner, u] = users.map((x) => x.session);
  const ownerProjects = await ok(owner.rpc('get_my_projects'));
  const pa = ownerProjects.find((p: any) => p.publicId === 'fixture-01').id,
    pb = ownerProjects.find((p: any) => p.publicId === 'fixture-02').id;
  record.projects = [pa, pb];
  await saveJournal();
  phase = 'isolation-and-mfa';
  await denied(client().rpc('get_my_projects'));
  assert.deepEqual(await ok(u.rpc('get_my_projects')), []);
  await denied(a.rpc('get_project_draft', { p_project: pb }));
  await denied(b.rpc('get_project_draft', { p_project: pa }));
  await denied(
    a.rpc('set_membership', {
      p_project: pb,
      p_user: users[0].id,
      p_active: true,
    }),
  );
  await denied(owner.rpc('get_people'));
  const factor =
    record.ownerFactor ||
    (await ok(
      owner.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Synthetic integration ${randomUUID().slice(0, 8)}`,
      }),
    ));
  record.ownerFactor = { id: factor.id, totp: { secret: factor.totp.secret } };
  await saveJournal();
  await ok(
    owner.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    }),
  );
  await ok(owner.rpc('get_people'));
  await ok(
    owner.rpc('set_membership', {
      p_project: pa,
      p_user: users[0].id,
      p_active: true,
    }),
  );
  phase = 'storage-and-submit';
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#ff00ff' },
  })
    .png()
    .toBuffer();
  const asset = await ok(
    a.rpc('reserve_upload', {
      p_project: pa,
      p_type: 'image/png',
      p_bytes: bytes.length,
    }),
  );
  await ok(
    a.storage
      .from('source-uploads')
      .upload(asset.path, bytes, { contentType: 'image/png', upsert: false }),
  );
  await denied(b.storage.from('source-uploads').download(asset.path));
  await denied(client().storage.from('source-uploads').download(asset.path));
  await denied(
    a.storage
      .from('source-uploads')
      .upload(asset.path, bytes, { contentType: 'image/png', upsert: true }),
  );
  await denied(
    a.storage
      .from('prepared-media')
      .upload(`${pa}/${randomUUID()}`, bytes, { contentType: 'image/webp' }),
  );
  const before = await ok(a.rpc('get_project_draft', { p_project: pa }));
  await ok(
    a.rpc('save_project_draft', {
      p_project: pa,
      p_expected_version: before.version,
      p_fields: {
        ...before.fields,
        assetId: asset.assetId,
        alt: 'Synthetic magenta square',
        credit: 'Local fixture',
      },
    }),
  );
  await denied(
    a.rpc('save_project_draft', {
      p_project: pa,
      p_expected_version: before.version,
      p_fields: before.fields,
    }),
  );
  const request = randomUUID(),
    args = {
      p_project: pa,
      p_expected_version: before.version + 1,
      p_request: request,
    };
  const sub = await ok(a.rpc('submit_project_revision', args));
  record.submission = sub;
  await saveJournal();
  assert.deepEqual(await ok(a.rpc('submit_project_revision', args)), sub);
  await denied(b.rpc('get_revision_preview', { p_revision: sub.revisionId }));
  phase = 'revocation';
  await ok(
    owner.rpc('set_membership', {
      p_project: pa,
      p_user: users[0].id,
      p_active: false,
    }),
  );
  await denied(a.rpc('get_project_draft', { p_project: pa }));
  await denied(a.storage.from('source-uploads').download(asset.path));
  await denied(
    client().auth.signUp({
      email: `not-invited-${randomUUID()}@example.invalid`,
      password: randomUUID(),
    }),
  );
  const report = {
    at: new Date().toISOString(),
    environment: 'isolated-local-supabase',
    result: 'passed',
    boundaries: [
      'closed signup',
      'real OTP verification and reuse denial',
      'real MFA gate',
      'cross-project RPC and Storage denial',
      'optimistic conflict',
      'idempotent submit',
      'retained-session revocation',
    ],
    notProven: [
      'mail delivery',
      'browser phone workflow',
      'hosted publication',
      'production restore',
    ],
  };
  await mkdir('docs/evidence/portal', { recursive: true });
  await writeFile(
    'docs/evidence/portal/local-supabase-integration.json',
    JSON.stringify(report, null, 2),
  );
  await saveJournal();
  process.stdout.write(
    'Local Supabase HTTP/Auth/Storage assertions passed. Only synthetic records were used; no delivery or deployment claim.\n',
  );
}
void main().catch((error) => {
  process.stderr.write(
    `LOCAL_INTEGRATION_FAILED at ${phase} (${/^INTEGRATION_REQUEST_FAILED:[A-Za-z0-9_-]+$/.test(error.message) ? error.message : 'ASSERTION_OR_SETUP_FAILED'}). Private journal retained; no reset or deletion performed.\n`,
  );
  process.exitCode = 1;
});
