// Real local Auth/SMTP/Edge proof. No remote endpoints or real identities accepted.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  localRuntime,
  fixtureJournal,
  fixtureSession,
  checked,
  mailCode,
} from './portal-local-runtime.ts';
const r = localRuntime(),
  j = await fixtureJournal(),
  origin = 'http://127.0.0.1:4321';
const owner = await fixtureSession(r, j.users[2], j.ownerFactor);
const token = (await owner.auth.getSession()).data.session!.access_token;
const checks: string[] = [];
let phase = 'configuration';
function sql(statement: string) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      'supabase_db_createch-showcase-local',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      statement,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, 'Local proof SQL failed');
  return result.stdout.trim();
}
const attempt = () => randomBytes(32).toString('base64url');
async function edge(name: string, body: object, bearer?: string) {
  const response = await fetch(r.url + '/functions/v1/' + name, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      apikey: r.pub,
      ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const ids: string[] = [];
async function invite() {
  const email = `participant-auth-${randomUUID()}@example.invalid`;
  const start = Date.now();
  const request = randomUUID();
  const result = await edge(
    'provision-participant',
    {
      email,
      projectId: j.projects[0],
      requestId: request,
      sendInvitation: true,
    },
    token,
  );
  assert.ok(
    result.status === 201 || result.status === 200,
    `Real owner provisioning failed (${result.status}: ${String(result.data?.code || 'UNKNOWN').replace(/[^A-Z_]/g, '')})`,
  );
  const id = sql(`select id from auth.users where email='${email}'`);
  assert.match(id, /^[a-f0-9-]{36}$/);
  ids.push(id);
  return { email, id, mail: await mailCode(r.mail, email, start) };
}
function age(id: string, hours: number) {
  assert(ids.includes(id));
  sql(
    `update auth.users set confirmation_sent_at=now()-interval '${hours} hours',recovery_sent_at=now()-interval '${hours} hours' where id='${id}' and email like 'participant-auth-%@example.invalid'`,
  );
}
async function consume(
  person: Awaited<ReturnType<typeof invite>>,
  code: string,
) {
  const k = attempt();
  assert.equal(
    (
      await edge('participant-auth-request', {
        email: person.email,
        attemptKey: k,
        mode: 'existing-code',
      })
    ).status,
    202,
  );
  return edge('participant-auth-verify', { attemptKey: k, code });
}
try {
  const inspect = spawnSync(
    'docker',
    ['inspect', 'supabase_auth_createch-showcase-local'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(inspect.status, 0);
  const env = JSON.parse(inspect.stdout)[0].Config.Env as string[];
  assert(env.includes('GOTRUE_MAILER_OTP_EXP=86400'));
  assert(env.includes('GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true'));
  checks.push(
    'actual local provider has 86400-second expiry and creation hook enabled',
  );
  phase = 'guard';
  assert(
    (
      await r.admin.auth.admin.inviteUserByEmail(
        `participant-auth-denied-${randomUUID()}@example.invalid`,
      )
    ).error,
    'No creation without owner intent',
  );
  checks.push('real Auth hook denies unreserved account creation');
  phase = 'before-expiry';
  const valid = await invite();
  age(valid.id, 23.99);
  assert(valid.mail.html.includes('24 hours'));
  const signed = await consume(valid, valid.mail.code);
  assert.equal(signed.status, 200);
  const participant = r.client();
  await checked(participant.auth.setSession(signed.data.session));
  assert.equal((await checked(participant.auth.getUser())).user.id, valid.id);
  assert(
    (await checked(participant.rpc('get_my_projects'))).some(
      (p: any) => p.id === j.projects[0],
    ),
  );
  checks.push(
    '23.99-hour invitation verifies through actual Edge service into original project',
  );
  assert.equal((await consume(valid, valid.mail.code)).status, 401);
  checks.push('consumed invitation cannot be replayed');
  phase = 'expired-recovery';
  const expired = await invite();
  age(expired.id, 24.01);
  assert.equal((await consume(expired, expired.mail.code)).status, 401);
  checks.push('24.01-hour invitation rejected by provider');
  const start = Date.now(),
    k = attempt();
  const resend = await edge('participant-auth-request', {
    email: expired.email,
    attemptKey: k,
    mode: 'send',
  });
  assert.equal(resend.status, 202);
  const fresh = await mailCode(r.mail, expired.email, start, [expired.mail.id]);
  assert.equal(
    sql(`select id from auth.users where email='${expired.email}'`),
    expired.id,
  );
  assert.equal(
    (await consume(expired, expired.mail.code)).status,
    401,
    'Replaced old code must fail',
  );
  const recovered = await edge('participant-auth-verify', {
    attemptKey: k,
    code: fresh.code,
  });
  assert.equal(recovered.status, 200);
  checks.push(
    'expired invitation resends to same account; replacement works and old code fails',
  );
  phase = 'returning';
  age(expired.id, 1);
  // Only synthetic application send timestamps are aged to avoid a real-time wait.
  sql(
    `update editorial.auth_last_send set sent_at=now()-interval '2 minutes' where email_hash in (select email_hash from editorial.auth_attempts where user_id='${expired.id}')`,
  );
  const returnStart = Date.now(),
    returnKey = attempt();
  assert.equal(
    (
      await edge('participant-auth-request', {
        email: expired.email,
        attemptKey: returnKey,
        mode: 'send',
      })
    ).status,
    202,
  );
  const returning = await mailCode(r.mail, expired.email, returnStart, [
    expired.mail.id,
    fresh.id,
  ]);
  assert.equal(
    (
      await edge('participant-auth-verify', {
        attemptKey: returnKey,
        code: returning.code,
      })
    ).status,
    200,
  );
  checks.push(
    'confirmed identity automatically uses returning email verification',
  );
  phase = 'direct-provider-controls';
  const throttled = await r.client().auth.signInWithOtp({
    email: expired.email,
    options: { shouldCreateUser: false },
  });
  assert.equal(
    throttled.error?.status,
    429,
    'Direct provider resend retains its own cooldown',
  );
  const stranger = `participant-auth-signup-${randomUUID()}@example.invalid`;
  assert(
    (await r.client().auth.signInWithOtp({ email: stranger })).error,
    'Direct public signup stays closed',
  );
  checks.push(
    'direct provider resend is throttled and public account creation denied',
  );
  phase = 'unknown';
  const before = sql('select count(*) from auth.users');
  assert.equal(
    (
      await edge('participant-auth-request', {
        email: 'participant-auth-unknown@example.invalid',
        attemptKey: attempt(),
        mode: 'send',
      })
    ).status,
    202,
  );
  assert.equal(sql('select count(*) from auth.users'), before);
  checks.push('unknown account request does not create a user');
  await mkdir('docs/evidence/participant-auth', { recursive: true });
  await writeFile(
    'docs/evidence/participant-auth/local-provider-proof.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        passed: true,
        checks,
        expirySeconds: 86400,
        scope:
          'Actual local Supabase Auth, Edge Functions, PostgreSQL and Mailpit; synthetic mail only',
        clock:
          'Only synthetic local timestamps adjusted; no wall-clock 24-hour wait',
        notProven: [
          'hosted configuration',
          'external delivery',
          'Cloudflare routing',
          'distributed abuse resistance',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks: checks.length,
      expirySeconds: 86400,
      realLocalProvider: true,
    }),
  );
} catch (error) {
  const detail =
    error instanceof assert.AssertionError
      ? error.message
      : error instanceof Error && /^LOCAL_[A-Z0-9_-]+$/.test(error.message)
        ? error.message
        : 'PROVIDER_OR_SETUP_ERROR';
  console.error(`PARTICIPANT_AUTH_PROOF_FAILED:${phase}:${detail}`);
  process.exitCode = 1;
}
