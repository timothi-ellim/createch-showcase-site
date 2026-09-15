import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { database, asUser, rpc, A, B, O, U, PA } from './database-harness.ts';
import {
  authHandler,
  digest,
  keyed,
} from '../../supabase/functions/_shared/participant-auth.ts';
const origin = 'https://workspace.example.invalid',
  pepper = 'synthetic-test-only-pepper-32-characters';
const key = () => randomBytes(32).toString('base64url');
async function setup() {
  const db = await database();
  await db.exec(
    `update auth.users set email=case id when '${A}' then 'a@example.invalid' when '${B}' then 'b@example.invalid' when '${O}' then 'o@example.invalid' else 'unknown@example.invalid' end,invited_at=now(); update auth.users set email_confirmed_at=now() where id in ('${B}','${O}');`,
  );
  await asUser(db, null, 'service_role');
  return db;
}
async function reserve(
  db: any,
  token: string,
  email = 'a@example.invalid',
  mode = 'send',
  network = 'local',
) {
  return rpc<any>(db, 'auth_request_reserve', [
    await digest(token),
    email,
    await keyed(pepper, 'email:' + email),
    await keyed(pepper, 'network:' + network),
    origin,
    mode,
  ]);
}
test('sign-in reservations hide eligibility, deduplicate and preserve verified identities', async () => {
  const db = await setup();
  try {
    const k = key(),
      first = await reserve(db, k);
    assert.equal(first.action, 'send');
    assert.equal(first.userId, A);
    assert.equal(first.kind, 'invite');
    assert.equal((await reserve(db, k)).action, 'complete');
    await assert.rejects(
      reserve(db, k, 'b@example.invalid'),
      /REQUEST_CONFLICT/,
    );
    assert.equal(
      (await reserve(db, key())).action,
      'complete',
      'per-address cooldown',
    );
    const returning = await reserve(db, key(), 'b@example.invalid');
    assert.equal(returning.kind, 'email');
    assert.equal(returning.userId, B);
    assert.equal(
      (await reserve(db, key(), 'nobody@example.invalid')).action,
      'complete',
    );
    await db.exec('reset role');
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::int as n from auth.users',
        )
      ).rows[0].n,
      4,
    );
    await asUser(db, A);
    await assert.rejects(reserve(db, key()), /permission denied/);
    await assert.rejects(
      db.query('select * from editorial.auth_attempts'),
      /permission denied/,
    );
    await asUser(db, null, 'anon');
    await assert.rejects(reserve(db, key()), /permission denied/);
  } finally {
    await db.close();
  }
});
test('verification is claimed once, checks revocation, expiry and cross-attempt budgets', async () => {
  const db = await setup();
  try {
    const k = key();
    await reserve(db, k, 'a@example.invalid', 'existing-code');
    const claim = await rpc<any>(db, 'auth_verify_claim', [
      await digest(k),
      origin,
      '1'.repeat(64),
    ]);
    assert.equal(claim.userId, A);
    assert.equal(
      (
        await rpc<any>(db, 'auth_verify_claim', [
          await digest(k),
          origin,
          '1'.repeat(64),
        ])
      ).action,
      'denied',
    );
    await db.exec(
      `reset role; update editorial.memberships set active=false where user_id='${A}'`,
    );
    await asUser(db, null, 'service_role');
    assert.equal(
      await rpc(db, 'auth_verify_finish', [
        await digest(k),
        claim.claim,
        A,
        true,
        false,
      ]),
      false,
    );
    await db.exec(
      `reset role; update editorial.memberships set active=true where user_id='${A}'`,
    );
    await asUser(db, null, 'service_role');
    for (let i = 0; i < 20; i++) {
      const t = key();
      await reserve(db, t, 'a@example.invalid', 'existing-code');
      const c = await rpc<any>(db, 'auth_verify_claim', [
        await digest(t),
        origin,
        '2'.repeat(64),
      ]);
      if (i < 19) {
        assert.equal(c.action, 'verify');
        await rpc(db, 'auth_verify_finish', [
          await digest(t),
          c.claim,
          A,
          false,
          false,
        ]);
      } else
        assert.equal(
          c.action,
          'denied',
          'rotating attempts cannot reset email failure budget',
        );
    }
    const old = key();
    await reserve(db, old, 'b@example.invalid', 'existing-code');
    await db.exec(
      `reset role; update editorial.auth_attempts set expires_at=now()-interval '1 second' where key_hash='${await digest(old)}'`,
    );
    await asUser(db, null, 'service_role');
    assert.equal(
      (
        await rpc<any>(db, 'auth_verify_claim', [
          await digest(old),
          origin,
          '3'.repeat(64),
        ])
      ).action,
      'denied',
    );
  } finally {
    await db.close();
  }
});
test('creation hook requires a fresh genuine MFA provisioning intent and consumes it', async () => {
  const db = await setup();
  try {
    await db.exec('reset role');
    const event = { user: { id: randomUUID(), email: 'new@example.invalid' } };
    assert.equal(
      (await rpc<any>(db, 'before_participant_created', [event])).error
        .http_code,
      403,
    );
    await asUser(db, O, 'authenticated', 'aal1');
    await assert.rejects(
      rpc(db, 'begin_provisioning', [randomUUID(), PA, event.user.email]),
      /MFA_REQUIRED/,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    await rpc(db, 'begin_provisioning', [randomUUID(), PA, event.user.email]);
    await db.exec('reset role');
    assert.deepEqual(await rpc(db, 'before_participant_created', [event]), {});
    assert.equal(
      (await rpc<any>(db, 'before_participant_created', [event])).error
        .http_code,
      403,
    );
    await asUser(db, A);
    await assert.rejects(
      rpc(db, 'before_participant_created', [event]),
      /permission denied/,
    );
    await asUser(db, O, 'authenticated', 'aal1');
    await assert.rejects(rpc(db, 'auth_resend_recipient', [A]), /MFA_REQUIRED/);
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal(
      (await rpc<any>(db, 'auth_resend_recipient', [A])).email,
      'a@example.invalid',
    );
    await assert.rejects(
      rpc(db, 'auth_resend_recipient', [U]),
      /ACCESS_DENIED/,
    );
  } finally {
    await db.close();
  }
});
test('HTTP service keeps token types private and returns only verified, consumed sessions', async () => {
  const db = await setup();
  let sends = 0;
  try {
    const deps = {
      origins: [origin],
      pepper,
      network: () => 'local',
      rpc: async (name: string, args: Record<string, unknown>) =>
        rpc(db, name, Object.values(args)),
      send: async () => {
        sends++;
        return 'accepted' as const;
      },
      verify: async (_e: string, _k: string, code: string) =>
        code === '123456'
          ? {
              user: {
                id: A,
                email: 'a@example.invalid',
                email_confirmed_at: '2026-09-15',
              },
              session: {
                access_token: 'synthetic-provider-token',
                refresh_token: 'synthetic-provider-refresh',
              },
            }
          : null,
      organiser: async () => {
        throw Error('MFA_REQUIRED');
      },
    };
    const request = authHandler('request', deps),
      verify = authHandler('verify', deps);
    const req = (data: any, o = origin) =>
      new Request(origin, {
        method: 'POST',
        headers: { origin: o, 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
    const token = key();
    const response = await request(
      req({ email: 'a@example.invalid', attemptKey: token, mode: 'send' }),
    );
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      status: 'check_email',
      retryAfterSeconds: 60,
    });
    await request(
      req({ email: 'a@example.invalid', attemptKey: token, mode: 'send' }),
    );
    assert.equal(sends, 1);
    const unknown = await request(
      req({ email: 'nobody@example.invalid', attemptKey: key(), mode: 'send' }),
    );
    assert.equal(unknown.status, 202);
    assert.equal(sends, 1);
    assert.equal(
      (
        await request(
          req(
            { email: 'a@example.invalid', attemptKey: key(), mode: 'send' },
            'https://evil.example',
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          req({
            email: 'a@example.invalid',
            attemptKey: key(),
            mode: 'send',
            admin: true,
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (await verify(req({ attemptKey: token, code: '000000' }))).status,
      401,
    );
    const success = await verify(req({ attemptKey: token, code: '123456' }));
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys((await success.json()).session).sort(), [
      'access_token',
      'refresh_token',
    ]);
    assert.equal(
      (await verify(req({ attemptKey: token, code: '123456' }))).status,
      401,
    );
  } finally {
    await db.close();
  }
});
