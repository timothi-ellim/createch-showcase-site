import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { localRuntime, checked, mailCode } from './portal-local-runtime.ts';
const r = localRuntime();
let phase = 'first-invite';
try {
  const email = `portal-mail-${randomUUID()}@example.invalid`,
    user = await checked(
      r.admin.auth.admin.createUser({ email, email_confirm: false }),
    ),
    session = r.client();
  assert.equal(user.user.email_confirmed_at, undefined);
  const before = Date.now();
  await checked(r.admin.auth.admin.inviteUserByEmail(email));
  const first = await mailCode(r.mail, email, before);
  assert.ok(first.subject.includes('CreaTech'));
  assert.ok(
    !first.html.includes('/auth/v1/verify?'),
    'Email must present a code, not a secret click-through link',
  );
  assert.ok(
    (await session.auth.verifyOtp({ email, token: '00000000', type: 'email' }))
      .error,
  );
  await checked(
    session.auth.verifyOtp({ email, token: first.code, type: 'invite' }),
  );
  assert.equal((await checked(session.auth.getUser())).user.id, user.user.id);
  assert.deepEqual(await checked(session.rpc('get_my_projects')), []);
  assert.ok(
    (
      await r
        .client()
        .auth.verifyOtp({ email, token: first.code, type: 'email' })
    ).error,
  );
  phase = 'throttle';
  await checked(
    session.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }),
  );
  assert.ok(
    (
      await r
        .client()
        .auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    ).error,
    'Immediate resend must be rate-limited',
  );
  // Advance only this synthetic identity's send timestamp to exercise returning
  // code and expiry without disabling provider throttles or waiting an hour.
  const sql = (statement: string) => {
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
        '-c',
        statement,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 0, 'Synthetic clock setup failed');
  };
  assert.match(user.user.id, /^[a-f0-9-]{36}$/);
  sql(
    `update auth.users set confirmation_sent_at=now()-interval '2 hours',recovery_sent_at=now()-interval '2 hours' where id='${user.user.id}';`,
  );
  phase = 'returning-mail';
  await checked(session.auth.signOut());
  const after = Date.now();
  await checked(
    session.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }),
  );
  const second = await mailCode(r.mail, email, after, [first.id]);
  assert.notEqual(second.id, first.id);
  phase = 'expired-code';
  sql(
    `update auth.users set confirmation_sent_at=now()-interval '2 hours',recovery_sent_at=now()-interval '2 hours' where id='${user.user.id}';`,
  );
  assert.ok(
    (await session.auth.verifyOtp({ email, token: second.code, type: 'email' }))
      .error,
    'Expired code must be denied',
  );
  const again = Date.now();
  await checked(
    session.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }),
  );
  const third = await mailCode(r.mail, email, again, [first.id, second.id]);
  await checked(
    session.auth.verifyOtp({ email, token: third.code, type: 'email' }),
  );
  phase = 'closed-signup';
  const stranger = `not-invited-${randomUUID()}@example.invalid`;
  assert.ok((await r.client().auth.signInWithOtp({ email: stranger })).error);
  assert.ok(
    (
      await r.client().auth.signInWithOtp({
        email: stranger,
        options: { shouldCreateUser: false },
      })
    ).error,
  );
  await writeFile(
    'docs/evidence/portal/local-mail-auth.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        result: 'passed',
        scope:
          'Real local Auth and Mailpit SMTP capture; synthetic mailboxes only',
        checks: [
          'unconfirmed first invite',
          'actual numeric-code email',
          'bad/reused/expired codes denied',
          'resend throttle',
          'returning fresh code',
          'closed signup and OTP auto-create denied',
        ],
        clockSetup:
          'Only synthetic test account timestamps advanced through trusted local database setup',
        notProven: [
          'external SMTP delivery',
          'institutional/personal mailboxes',
          'real phone usability',
        ],
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    'Real local code email, first/returning sign-in, throttling and invalid-code checks passed.\n',
  );
} catch (error) {
  process.stderr.write(
    `LOCAL_MAIL_TEST_FAILED at ${phase}: ${(error as Error).message.replace(/[^A-Za-z0-9 _:-]/g, '').slice(0, 160)}\n`,
  );
  process.exitCode = 1;
}
