import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, asUser, rpc, A, B, O, PA, PB } from './database-harness.ts';
import {
  eventSlots,
  selectionWindows,
  validateWindows,
} from '../../src/lib/presence.ts';
const event = {
  date: '2026-10-28',
  startTime: '11:00',
  endTime: '16:00',
  timeZone: 'Europe/London',
};
const selected = { mode: 'selected_slots', slots: [0, 1, 2, 6, 7] };

test('event slots and public ranges use exact aligned intervals, preserve gaps and reject invalid input', () => {
  assert.equal(eventSlots(event).length, 10);
  const windows = selectionWindows(event, selected as any);
  assert.deepEqual(windows, [
    { start: '11:00', end: '12:30' },
    { start: '14:00', end: '15:00' },
  ]);
  validateWindows(event, windows);
  for (const slots of [[0, 0], [-1], [10], [0.5], []])
    assert.throws(() =>
      selectionWindows(event, { mode: 'selected_slots', slots }),
    );
  for (const mode of ['unsure', 'not_attending'] as const)
    assert.deepEqual(selectionWindows(event, { mode, slots: [] }), []);
  assert.deepEqual(
    selectionWindows(event, { mode: 'whole_event', slots: [] }),
    [{ start: '11:00', end: '16:00' }],
  );
  assert.throws(() =>
    validateWindows(event, [
      { start: '11:00', end: '12:00' },
      { start: '12:00', end: '13:00' },
    ]),
  );
  assert.throws(() =>
    validateWindows(event, [{ start: '11:05', end: '12:00' }]),
  );
  assert.throws(() => eventSlots({ ...event, endTime: '16:05' }));
});

test('presence RPCs isolate projects, freeze submissions, handle retry/conflict, enforce MFA and keep notes private', async () => {
  const db = await database();
  try {
    await asUser(db, null, 'anon');
    await assert.rejects(rpc(db, 'get_presence', [PA]), /permission denied/);
    await asUser(db, A);
    assert.equal((await rpc(db, 'get_presence', [PA])).draft, null);
    await assert.rejects(rpc(db, 'get_presence', [PB]), /ACCESS_DENIED/);
    await assert.rejects(
      rpc(db, 'save_presence_draft', [PB, 0, 1, selected]),
      /ACCESS_DENIED/,
    );
    for (const slots of [[10], [0, 0], ['0'], [0.25]])
      await assert.rejects(
        rpc(db, 'save_presence_draft', [
          PA,
          0,
          1,
          { mode: 'selected_slots', slots },
        ]),
        /INVALID_PRESENCE/,
      );
    await assert.rejects(
      rpc(db, 'save_presence_draft', [PA, 0, 1, { ...selected, private: 'x' }]),
      /INVALID_PRESENCE/,
    );
    const saved = await rpc(db, 'save_presence_draft', [PA, 0, 1, selected]);
    assert.deepEqual(
      await rpc(db, 'save_presence_draft', [PA, 0, 1, selected]),
      saved,
    );
    await assert.rejects(
      rpc(db, 'save_presence_draft', [PA, 0, 1, { mode: 'unsure', slots: [] }]),
      /DRAFT_CONFLICT/,
    );
    const request = randomUUID(),
      sub = await rpc(db, 'submit_presence', [PA, 1, request]);
    assert.deepEqual(await rpc(db, 'submit_presence', [PA, 1, request]), sub);
    await rpc(db, 'save_presence_draft', [
      PA,
      1,
      1,
      { mode: 'unsure', slots: [] },
    ]);
    const record = await rpc(db, 'get_presence', [PA]);
    assert.deepEqual(
      record.latest.windows,
      selectionWindows(event, selected as any),
    );
    await asUser(db, B);
    await assert.rejects(rpc(db, 'get_presence_overview'), /ACCESS_DENIED/);
    await asUser(db, O);
    const args = [
      sub.revisionId,
      sub.digest,
      0,
      'approved',
      null,
      'Participant feedback',
      '',
      'SECRET_PRESENCE_NOTE',
      false,
      randomUUID(),
    ];
    await assert.rejects(rpc(db, 'decide_presence', args), /MFA_REQUIRED/);
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal(await rpc(db, 'decide_presence', args), 1);
    assert.equal(await rpc(db, 'decide_presence', args), 1);
    assert.equal(
      (await rpc(db, 'get_presence_review', [PA])).reviewHistory[0].note,
      'SECRET_PRESENCE_NOTE',
    );
    const overview = await rpc(db, 'get_presence_overview');
    assert.equal(overview.length, 2);
    assert.equal(overview.find((p: any) => p.projectId === PB).latest, null);
    await asUser(db, A);
    await assert.rejects(rpc(db, 'get_presence_review', [PA]), /ACCESS_DENIED/);
    const reviewed = await rpc(db, 'get_presence', [PA]);
    assert.equal(reviewed.latest.decision.feedback, 'Participant feedback');
    assert.ok(!JSON.stringify(reviewed).includes('SECRET_PRESENCE_NOTE'));
    await assert.rejects(
      db.query('select * from editorial.presence_revisions'),
      /permission denied/,
    );
    await db.exec('reset role');
    await assert.rejects(
      db.query('update editorial.presence_revisions set windows=$1', ['[]']),
      /IMMUTABLE_PRESENCE_RECORD/,
    );
    await asUser(db, O, 'authenticated', 'aal2');
    await rpc(db, 'set_membership', [PA, A, false]);
    await asUser(db, A);
    await assert.rejects(rpc(db, 'get_presence', [PA]), /ACCESS_DENIED/);
  } finally {
    await db.close();
  }
});

test('event changes require reconfirmation only for schedule changes; negative proposals need explicit positive confirmation', async () => {
  const db = await database();
  try {
    await asUser(db, A);
    await rpc(db, 'save_presence_draft', [
      PA,
      0,
      1,
      { mode: 'not_attending', slots: [] },
    ]);
    const sub = await rpc(db, 'submit_presence', [PA, 1, randomUUID()]);
    await asUser(db, O, 'authenticated', 'aal2');
    const args = [
      sub.revisionId,
      sub.digest,
      0,
      'approved',
      { mode: 'whole_event', slots: [] },
      '',
      'Agreed directly',
      '',
      false,
      randomUUID(),
    ];
    await assert.rejects(
      rpc(db, 'decide_presence', args),
      /PRESENCE_CONFIRMATION_REQUIRED/,
    );
    args[8] = true;
    await rpc(db, 'decide_presence', args);
    assert.equal(
      (await rpc(db, 'get_presence_review', [PA])).reviewHistory[0]
        .confirmedPositiveOverride,
      true,
    );
    const admin = await rpc(db, 'get_event_administration');
    await rpc(db, 'record_event_config', [
      1,
      { ...admin.event.config, arrivalInformation: 'Confirmed later' },
      admin.event.themes,
    ]);
    await asUser(db, A);
    assert.equal(
      (await rpc(db, 'get_presence', [PA])).scheduleKey,
      (await rpc(db, 'get_presence', [PA])).draft.scheduleKey,
    );
    await rpc(db, 'submit_presence', [PA, 1, randomUUID()]);
    await rpc(db, 'save_presence_draft', [
      PA,
      1,
      1,
      { mode: 'unsure', slots: [] },
    ]);
    await asUser(db, O, 'authenticated', 'aal2');
    await rpc(db, 'record_event_config', [
      2,
      { ...admin.event.config, startTime: '10:00' },
      admin.event.themes,
    ]);
    await asUser(db, A);
    await assert.rejects(
      rpc(db, 'submit_presence', [PA, 2, randomUUID()]),
      /PRESENCE_EVENT_CHANGED/,
    );
  } finally {
    await db.close();
  }
});
