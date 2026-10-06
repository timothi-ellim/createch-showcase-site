import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, asUser, rpc } from './database-harness.ts';
const event = JSON.parse(readFileSync('content/event.json', 'utf8'));

test('500 subscribers fit two sending days; exhausted budgets reject admission and never overclaim', async () => {
  const db = await database();
  try {
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_configure', [event, 'http://127.0.0.1:4339', 'a'.repeat(64), true]);
    await db.exec('reset role');
    await db.exec(`update editorial.reminder_campaign set paused=false,week_at=now()-interval '1 hour',week_until=now()+interval '35 hours';
      insert into editorial.reminder_subscribers(email,nonce,confirm_digest,unsubscribe_digest,confirm_expires,confirmed_at)
      select 'synthetic-'||i||'@example.invalid',repeat('a',32),repeat('b',64),repeat('c',64),now()+interval '24 hours',now() from generate_series(1,500) i;
      insert into editorial.reminder_outbox(subscriber_id,kind,revision,nonce,due_at,expires_at)
      select id,'week',repeat('a',64),'scheduled',now()-interval '1 minute',now()+interval '35 hours' from editorial.reminder_subscribers;`);
    await asUser(db, null, 'service_role');
    const args = ['extra@example.invalid', 'd'.repeat(64), 'e'.repeat(32), 'f'.repeat(64), '0'.repeat(64)];
    assert.equal(await rpc(db, 'reminder_request', args), 'full');
    for (let i = 0; i < 300; i++) {
      const job = await rpc(db, 'reminder_claim');
      assert.ok(job);
      await rpc(db, 'reminder_receipt', [job.id, job.lease, 'accepted', `synthetic-${i}`]);
    }
    assert.equal(await rpc(db, 'reminder_claim'), null);
    assert.equal(await rpc(db, 'reminder_request', args), 'busy');
    await db.exec('reset role');
    await db.exec("update editorial.reminder_dispatch_log set attempted_at=now()-interval '25 hours'");
    await asUser(db, null, 'service_role');
    for (let i = 0; i < 200; i++) {
      const job = await rpc(db, 'reminder_claim');
      assert.ok(job);
      await rpc(db, 'reminder_receipt', [job.id, job.lease, 'accepted', `synthetic-second-${i}`]);
    }
    assert.equal(await rpc(db, 'reminder_claim'), null);
    await db.exec('reset role');
    assert.equal((await db.query<{ n: number }>("select count(*)::int n from editorial.reminder_outbox where status='accepted'")).rows[0].n, 500);
  } finally { await db.close(); }
});

test('late confirmations still receive an open window and confirmation traffic reserves scheduled capacity', async () => {
  const db = await database();
  try {
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_configure', [event, 'http://127.0.0.1:4339', 'a'.repeat(64), true]);
    await db.exec('reset role');
    await db.exec("update editorial.reminder_campaign set paused=false,week_at=now()-interval '1 hour',week_until=now()+interval '35 hours'");
    await asUser(db, null, 'service_role');
    await rpc(db, 'reminder_request', ['late@example.invalid','a'.repeat(64),'b'.repeat(32),'c'.repeat(64),'d'.repeat(64)]);
    await rpc(db, 'reminder_token', ['c'.repeat(64),'confirm']);
    await db.exec('reset role');
    assert.equal((await db.query<{ n: number }>("select count(*)::int n from editorial.reminder_outbox where kind='week' and due_at<=now() and expires_at>now()+interval '34 hours'")).rows[0].n, 1);
    await db.exec("insert into editorial.reminder_dispatch_log(kind) select 'confirm' from generate_series(1,50)");
    await asUser(db, null, 'service_role');
    assert.equal(await rpc(db, 'reminder_request', ['wait@example.invalid','e'.repeat(64),'f'.repeat(32),'0'.repeat(64),'1'.repeat(64)]), 'busy');
    assert.equal((await rpc(db, 'reminder_claim')).kind, 'week', 'scheduled delivery remains eligible while confirmations are limited');
  } finally { await db.close(); }
});
