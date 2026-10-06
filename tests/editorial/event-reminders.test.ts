import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  eventInstants,
  reminderSchedule,
  zonedInstant,
  countdown,
} from '../../src/lib/event-time.ts';
import {
  calendarFile,
  googleCalendarUrl,
} from '../../src/lib/event-calendar.ts';
import {
  normaliseEmail,
  signedToken,
  sha256,
  deliverBatch,
  serviceRPC,
  type MailJob,
} from '../../editorial/reminders.ts';
import { verifyMailWebhook } from '../../editorial/reminders-webhook.ts';
const event = JSON.parse(readFileSync('content/event.json', 'utf8'));
test('hosted void RPCs accept HTTP 204 without a JSON body', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  assert.equal(await serviceRPC('https://example.supabase.co', 'synthetic-secret')('reminder_cleanup'), undefined);
});
test('countdown boundaries and local-day reminders cross UK clock change correctly', () => {
  const { start, end } = eventInstants(event);
  assert.equal(new Date(start).toISOString(), '2026-10-28T11:00:00.000Z');
  assert.equal(new Date(end).toISOString(), '2026-10-28T16:00:00.000Z');
  assert.deepEqual(reminderSchedule(event), [
    {
      kind: 'week',
      at: '2026-10-20T10:00:00.000Z',
      until: '2026-10-21T22:00:00.000Z',
    },
    {
      kind: 'day',
      at: '2026-10-26T11:00:00.000Z',
      until: '2026-10-27T23:00:00.000Z',
    },
  ]);
  assert.deepEqual(countdown(start, end, start - 60001), {
    state: 'before',
    days: 0,
    hours: 0,
    minutes: 2,
  });
  assert.equal(countdown(start, end, start).state, 'today');
  assert.equal(countdown(start, end, end).state, 'ended');
  assert.throws(
    () => zonedInstant('2026-03-29', '01:30', 'Europe/London'),
    /INVALID_EVENT_TIME/,
  );
  assert.throws(
    () => zonedInstant('2026-10-25', '01:30', 'Europe/London'),
    /AMBIGUOUS_EVENT_TIME/,
  );
  assert.throws(() => zonedInstant('2026-02-30', '11:00', 'Europe/London'));
});
test('calendar has valid UTC instants, stable UID, escaped data and UTF-8 line folding', () => {
  const ics = calendarFile(
    { ...event, title: 'É'.repeat(90) + '\nBEGIN:VEVENT;injection,' },
    'https://example.invalid',
  );
  assert.match(ics, /DTSTART:20261028T110000Z\r\nDTEND:20261028T160000Z/);
  assert.equal(ics.split('\r\nBEGIN:VEVENT').length, 2);
  assert.match(ics.replace(/\r\n /g, ''), /\\nBEGIN:VEVENT\\;injection\\,/);
  for (const line of ics.split('\r\n'))
    assert.ok(Buffer.byteLength(line) <= 75);
  const google = new URL(googleCalendarUrl(event, 'https://example.invalid'));
  assert.equal(
    google.searchParams.get('dates'),
    '20261028T110000Z/20261028T160000Z',
  );
  assert.equal(google.searchParams.get('ctz'), 'Europe/London');
});
test('tokens are scoped and email aliases are not merged', async () => {
  assert.equal(
    normaliseEmail('  Visitor+one@EXAMPLE.invalid '),
    'Visitor+one@example.invalid',
  );
  assert.throws(() =>
    normaliseEmail('victim@example.invalid\r\nBcc:other@example.invalid'),
  );
  const secret = 'synthetic-secret-for-tests-only-000000';
  assert.notEqual(
    await signedToken(secret, 'confirm', 'a'),
    await signedToken(secret, 'unsubscribe', 'a'),
  );
  assert.equal((await sha256('test')).length, 64);
});
test('webhook verification matches the official Svix example and rejects tampering and old timestamps', async () => {
  const body = '{"event_type":"ping","data":{"success":true}}';
  const headers = {
    'svix-id': 'msg_loFOjxBNrRLzqYUf',
    'svix-timestamp': '1731705121',
    'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
  };
  const req = (text = body) =>
    new Request('https://example.invalid/webhook', {
      method: 'POST',
      headers,
      body: text,
    });
  const key = 'whsec_plJ3nmyCDGBKInavdOK15jsl';
  assert.deepEqual(
    await verifyMailWebhook(req(), key, 1731705121000),
    JSON.parse(body),
  );
  await assert.rejects(
    verifyMailWebhook(req(body + ' '), key, 1731705121000),
    /INVALID_SIGNATURE/,
  );
  await assert.rejects(
    verifyMailWebhook(req(), key, 1731706121000),
    /INVALID_SIGNATURE/,
  );
});
test('worker rechecks opt-out just before sending and preserves ambiguous outcomes', async () => {
  const job: MailJob = {
    id: 'test',
    lease: 'lease',
    kind: 'day',
    revision: 'a'.repeat(64),
    nonce: 'scheduled',
    email: 'synthetic@example.invalid',
    event,
    origin: 'https://example.invalid',
  };
  for (const eligible of [false, true]) {
    const calls: string[] = [];
    let claimed = false,
      sent = 0;
    const rpc: any = async (name: string, args: any) => {
      calls.push(name);
      if (name === 'reminder_claim') {
        if (claimed) return null;
        claimed = true;
        return job;
      }
      if (name === 'reminder_send_check') return eligible;
      if (name === 'reminder_receipt')
        assert.equal(args.p_status, eligible ? 'uncertain' : 'cancelled');
    };
    await deliverBatch(
      rpc,
      'synthetic-secret-for-tests-only-000000',
      async () => {
        sent++;
        throw new Error('unknown result');
      },
    );
    assert.equal(sent, eligible ? 1 : 0);
    assert.ok(calls.includes('reminder_send_check'));
  }
});
