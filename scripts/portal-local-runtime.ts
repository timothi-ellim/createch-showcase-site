import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { checkPortalEnvironment } from '../src/lib/portal-contract.ts';
export function localRuntime() {
  const status = spawnSync(
    process.execPath,
    ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (status.status !== 0) throw new Error('LOCAL_SUPABASE_UNAVAILABLE');
  const env: Record<string, string> = {};
  for (const line of status.stdout.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?\r?$/);
    if (m) env[m[1]] = m[2].replace(/"$/, '');
  }
  const url = env.API_URL,
    key = env.SERVICE_ROLE_KEY || env.SECRET_KEY,
    pub = env.ANON_KEY || env.PUBLISHABLE_KEY;
  checkPortalEnvironment(url, 'local', 'http://127.0.0.1:4321');
  const mail = new URL(env.MAILPIT_URL || env.INBUCKET_URL);
  if (!['127.0.0.1', 'localhost'].includes(mail.hostname))
    throw new Error('LOCAL_MAIL_REQUIRED');
  const client = (secret = pub) =>
    createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  return { url, key, pub, mail: mail.origin, client, admin: client(key) };
}
export async function fixtureJournal() {
  return JSON.parse(
    await readFile(
      join(tmpdir(), 'createch-supabase-local', 'integration.private.json'),
      'utf8',
    ),
  );
}
export async function checked(p: PromiseLike<any>) {
  const { data, error } = await p;
  if (error)
    throw new Error(
      `LOCAL_REQUEST_FAILED_${String(error.code || error.status || 'unknown').replace(/[^A-Za-z0-9_-]/g, '')}`,
    );
  return data;
}
export function totp(secret: string) {
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
export async function fixtureSession(
  runtime: ReturnType<typeof localRuntime>,
  identity: { id: string; email: string },
  factor?: { id: string; totp: { secret: string } },
) {
  if (
    !identity.email.startsWith('portal-integration-') ||
    !identity.email.endsWith('@example.invalid')
  )
    throw new Error('SYNTHETIC_IDENTITY_REQUIRED');
  const link = await checked(
      runtime.admin.auth.admin.generateLink({
        type: 'magiclink',
        email: identity.email,
      }),
    ),
    client = runtime.client();
  await checked(
    client.auth.verifyOtp({
      email: identity.email,
      token: link.properties.email_otp,
      type: 'email',
    }),
  );
  if (factor)
    await checked(
      client.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: totp(factor.totp.secret),
      }),
    );
  return client;
}
export async function mailCode(
  mail: string,
  email: string,
  after: number,
  exclude: string[] = [],
) {
  for (let i = 0; i < 30; i++) {
    const found = await (
      await fetch(
        `${mail}/api/v1/search?query=${encodeURIComponent('to:' + email)}`,
      )
    ).json();
    for (const m of found.messages || []) {
      if (exclude.includes(m.ID)) continue;
      const msg = await (
        await fetch(`${mail}/api/v1/message/${encodeURIComponent(m.ID)}`)
      ).json();
      if (Date.parse(msg.Date) < after - 1000) continue;
      const code = (msg.Text || msg.HTML || '').match(/\b\d{6}\b/)?.[0];
      if (code)
        return { code, id: msg.ID, subject: msg.Subject, html: msg.HTML };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('LOCAL_MAIL_NOT_OBSERVED');
}
