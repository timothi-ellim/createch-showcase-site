import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, asUser, rpc, A, O } from './database-harness.ts';
import { reminderHandler } from '../../editorial/reminders-http.ts';
import {
  signedToken,
  sha256,
  deliverBatch,
  type ReminderRPC,
  type Mail,
} from '../../editorial/reminders.ts';
const event = JSON.parse(readFileSync('content/event.json', 'utf8'));
const secret = 'synthetic-local-mail-token-secret-000000000';
const origin = 'http://127.0.0.1:4339';
test('database-backed confirmation, private counts, unsubscribe, duplicate protection and HTTP failures', async () => {
  const db = await database();
  try {
    const call: ReminderRPC = (name, args = {}) =>
      rpc(db, name, Object.values(args));
    await asUser(db, null, 'service_role');
    await call('reminder_configure', {
      event,
      origin,
      revision: 'a'.repeat(64),
      ready: true,
    });
    await asUser(db, O, 'authenticated', 'aal2');
    await call('reminder_pause', { paused: false });
    const handler = reminderHandler({
      rpc: call,
      secret,
      origin,
      enabled: true,
      local: true,
      source: () => 'synthetic-source',
    });
    const post = (
      path: string,
      data: Record<string, string>,
      headers: Record<string, string> = {},
    ) =>
      new Request(origin + path, {
        method: 'POST',
        headers: {
          origin,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          ...headers,
        },
        body: new URLSearchParams(data),
      });
    await asUser(db, null, 'service_role');
    const unavailable = reminderHandler({
      rpc: async () => {
        throw new Error(
          'A missing configuration must never reach the database',
        );
      },
      secret: '',
      origin: '',
      enabled: false,
      source: () => 'synthetic',
    });
    assert.equal(
      (
        await unavailable(
          post('/api/reminders/subscribe', {
            email: 'test@example.invalid',
            consent: 'yes',
          }),
        )
      ).status,
      503,
    );
    assert.equal(
      (
        await handler(
          post(
            '/api/reminders/subscribe',
            { email: 'synthetic@example.invalid', consent: 'yes' },
            { origin: 'https://evil.invalid' },
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await handler(
          post(
            '/api/reminders/subscribe',
            { email: 'synthetic@example.invalid', consent: 'yes' },
            { origin: 'null', 'sec-fetch-site': 'cross-site' },
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await handler(
          post('/api/reminders/subscribe', {
            email: 'real@example.com',
            consent: 'yes',
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await handler(
          post('/api/reminders/subscribe', {
            email: 'synthetic@example.invalid',
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await handler(
          post('/api/reminders/subscribe', {
            email: 'synthetic@example.invalid',
            consent: 'yes',
          }),
        )
      ).status,
      202,
    );
    assert.equal(
      (
        await handler(
          post('/api/reminders/subscribe', {
            email: 'synthetic@example.invalid',
            consent: 'yes',
          }),
        )
      ).status,
      202,
    );
    const mails: Mail[] = [];
    assert.equal(
      (
        await deliverBatch(call, secret, async (mail) => {
          mails.push(mail);
          return { status: 'accepted', providerId: 'synthetic-mail-1' };
        })
      ).accepted,
      1,
    );
    assert.equal(mails.length, 1);
    const token = mails[0].text.match(/confirm\?token=([a-f0-9]+)/)![1];
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal((await call('reminder_stats')).active, 0);
    await asUser(db, null, 'service_role');
    assert.equal(
      (
        await handler(
          new Request(`${origin}/api/reminders/confirm?token=${token}`),
        )
      ).status,
      200,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal(
      (await call('reminder_stats')).active,
      0,
      'GET/email scanners cannot opt in',
    );
    await asUser(db, null, 'service_role');
    assert.equal(
      (
        await handler(
          post(
            '/api/reminders/confirm',
            { token },
            { origin: 'null', 'sec-fetch-site': 'same-origin' },
          ),
        )
      ).status,
      200,
    );
    assert.equal(
      (await handler(post('/api/reminders/confirm', { token }))).status,
      200,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    const stats = await call('reminder_stats');
    assert.equal(stats.active, 1);
    assert.equal(stats.pending, 0);
    assert.ok(!JSON.stringify(stats).includes('@'));
    for (const [user, role, aal] of [
      [null, 'anon', 'aal1'],
      [A, 'authenticated', 'aal1'],
      [O, 'authenticated', 'aal1'],
    ] as const) {
      await asUser(db, user, role, aal);
      await assert.rejects(
        call('reminder_stats'),
        /permission denied|ACCESS_DENIED|MFA_REQUIRED/,
      );
      await assert.rejects(
        db.query('select email from editorial.reminder_subscribers'),
        /permission denied/,
      );
      await assert.rejects(call('reminder_claim'), /permission denied/);
    }
    await asUser(db, O, 'authenticated', 'aal2');
    await call('reminder_pause', { paused: true });
    await asUser(db, null, 'service_role');
    const unsubscribe = await signedToken(
      secret,
      'unsubscribe',
      'synthetic@example.invalid',
    );
    assert.equal(
      (
        await handler(
          post('/api/reminders/unsubscribe', { token: unsubscribe }),
        )
      ).status,
      200,
    );
    assert.equal(
      (await handler(post('/api/reminders/confirm', { token }))).status,
      410,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal((await call('reminder_stats')).active, 0);
    await db.exec('reset role');
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from editorial.reminder_outbox where status='queued'",
        )
      ).rows[0].n,
      0,
    );
    const privateRecord = JSON.stringify(
      (await db.query('select * from editorial.reminder_subscribers')).rows,
    );
    assert.ok(!privateRecord.includes(token));
    assert.ok(!privateRecord.includes(unsubscribe));
    assert.equal(
      (await handler(post('/api/reminders/confirm', { token: 'invalid' })))
        .status,
      400,
    );
  } finally {
    await db.close();
  }
});

test('expiry, suppression, source limits, leases and campaign changes fail safely', async () => {
  const db = await database();
  try {
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_configure', [event, origin, 'b'.repeat(64), true]);
    await db.exec('reset role');
    await db.exec('update editorial.reminder_campaign set paused=false');
    await asUser(db, null, 'service_role');
    const args = [
      'second@example.invalid',
      'a'.repeat(64),
      'b'.repeat(32),
      await sha256('c'.repeat(64)),
      await sha256('d'.repeat(64)),
    ];
    await rpc(db, 'reminder_request', args);
    const job = await rpc(db, 'reminder_claim');
    assert.ok(job?.lease);
    assert.equal(
      await rpc(db, 'reminder_claim'),
      null,
      'claimed jobs cannot be claimed twice',
    );
    await assert.rejects(
      rpc(db, 'reminder_receipt', [
        job.id,
        '00000000-0000-4000-8000-000000000000',
        'accepted',
        'test',
      ]),
      /STALE_LEASE/,
    );
    await rpc(db, 'reminder_receipt', [
      job.id,
      job.lease,
      'accepted',
      'synthetic-provider',
    ]);
    await rpc(db, 'reminder_delivery_status', [
      'synthetic-provider',
      'bounced',
    ]);
    await assert.rejects(
      rpc(db, 'reminder_token', [await sha256('c'.repeat(64)), 'confirm']),
      /EXPIRED_LINK/,
    );
    await assert.rejects(
      rpc(db, 'reminder_configure', [
        { ...event, startTime: '12:00' },
        origin,
        'c'.repeat(64),
        true,
      ]),
      /CAMPAIGN_CHANGE_REQUIRES_REVIEW/,
    );
    for (let i = 0; i < 12; i++) await rpc(db, 'reminder_request', args);
    assert.equal(await rpc(db, 'reminder_request', args), 'limited');
    await rpc(db, 'reminder_request', [
      'pending@example.invalid',
      'f'.repeat(64),
      ...args.slice(2),
    ]);
    await db.exec('reset role');
    await db.exec(
      "update editorial.reminder_subscribers set requested_at=now()-interval '8 days'",
    );
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_cleanup');
    await db.exec('reset role');
    assert.equal(
      (await db.query('select * from editorial.reminder_subscribers')).rows
        .length,
      1,
      'expired pending requests are removed while bounce suppression survives',
    );
    await db.exec(
      "update editorial.reminder_campaign set ends_at=now()-interval '31 days'",
    );
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_cleanup');
    await db.exec('reset role');
    assert.equal(
      (await db.query('select * from editorial.reminder_subscribers')).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});

test('scheduled sends, resubscription, failed retry, stale publication and interrupted leases', async () => {
  const db = await database();
  try {
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_configure', [event, origin, 'e'.repeat(64), true]);
    await db.exec('reset role');
    await db.exec(
      "update editorial.reminder_campaign set paused=false,week_at=now()-interval '2 days',week_until=now()-interval '1 day',day_at=now()+interval '1 hour'",
    );
    await asUser(db, null, 'service_role');
    const args = [
      'scheduled@example.invalid',
      'e'.repeat(64),
      'f'.repeat(32),
      'a'.repeat(64),
      'b'.repeat(64),
    ];
    await rpc(db, 'reminder_request', args);
    let job = await rpc(db, 'reminder_claim');
    await rpc(db, 'reminder_receipt', [
      job.id,
      job.lease,
      'accepted',
      'synthetic-confirm',
    ]);
    await rpc(db, 'reminder_token', ['a'.repeat(64), 'confirm']);
    await rpc(db, 'reminder_token', ['a'.repeat(64), 'confirm']);
    await db.exec('reset role');
    let jobs = (
      await db.query<{ kind: string; status: string }>(
        'select kind,status from editorial.reminder_outbox',
      )
    ).rows;
    assert.equal(
      jobs.filter((j) => j.kind === 'week').length,
      0,
      'late subscriptions skip past reminders',
    );
    assert.equal(
      jobs.filter((j) => j.kind === 'day').length,
      1,
      'confirmation is idempotent',
    );
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_token', ['b'.repeat(64), 'unsubscribe']);
    await db.exec('reset role');
    await db.exec(
      "update editorial.reminder_subscribers set requested_at=now()-interval '3 minutes'",
    );
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_request', [
      args[0],
      args[1],
      '0'.repeat(32),
      'c'.repeat(64),
      args[4],
    ]);
    await rpc(db, 'reminder_token', ['c'.repeat(64), 'confirm']);
    await db.exec('reset role');
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from editorial.reminder_outbox where kind='day' and status='queued'",
        )
      ).rows[0].n,
      1,
    );
    await db.exec(
      "update editorial.reminder_outbox set status='cancelled' where kind='confirm' and status='queued'; update editorial.reminder_outbox set due_at=now()-interval '1 minute',expires_at=now()+interval '30 minutes' where kind='day'",
    );
    await asUser(db, null, 'service_role');
    job = await rpc(db, 'reminder_claim');
    assert.equal(job.kind, 'day');
    await rpc(db, 'reminder_receipt', [job.id, job.lease, 'failed', null]);
    await asUser(db, O, 'authenticated', 'aal2');
    await rpc(db, 'reminder_retry', [job.id]);
    await asUser(db, null, 'service_role');
    job = await rpc(db, 'reminder_claim');
    await rpc(db, 'reminder_delivery_status', [
      'synthetic-early-bounce',
      'bounced',
    ]);
    await rpc(db, 'reminder_receipt', [
      job.id,
      job.lease,
      'accepted',
      'synthetic-early-bounce',
    ]);
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal((await rpc(db, 'reminder_stats')).suppressed, 1);
    await db.exec('reset role');
    await db.exec(
      "update editorial.reminder_outbox set status='sending',claimed_at=now()-interval '6 minutes' where kind='day'",
    );
    await asUser(db, null, 'service_role');
    assert.equal(await rpc(db, 'reminder_claim'), null);
    await asUser(db, O, 'authenticated', 'aal2');
    assert.ok(
      (await rpc<any[]>(db, 'reminder_attention')).some(
        (j) => j.status === 'uncertain' && !j.canRetry,
      ),
    );
    await assert.rejects(
      rpc(db, 'reminder_retry', [job.id]),
      /RETRY_UNAVAILABLE/,
    );
    // A bounced unconfirmed request must remain suppressed after pending cleanup.
    await db.exec('reset role');
    await db.exec(
      "update editorial.reminder_subscribers set confirmed_at=null,requested_at=now()-interval '8 days' where suppressed_at is not null",
    );
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_cleanup');
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal((await rpc(db, 'reminder_stats')).suppressed, 1);
    await db.exec('reset role');
    await db.exec("update editorial.settings set environment='staging'");
    await asUser(db, null, 'service_role');
    assert.equal((await rpc(db, 'reminder_config')).current, false);
    await assert.rejects(
      rpc(db, 'reminder_request', [
        'third@example.invalid',
        args[1],
        args[2],
        args[3],
        args[4],
      ]),
      /REMINDERS_UNAVAILABLE/,
    );
  } finally {
    await db.close();
  }
});
