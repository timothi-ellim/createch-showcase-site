import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, asUser, rpc, A, B, O } from './database-harness.ts';

test('only an MFA-verified owner can create private projects; retries preserve drafts and assignments', async () => {
  const db = await database();
  const request = randomUUID();
  const args = [
    request,
    'synthetic-new-work',
    'Synthetic new work',
    'Synthetic contributor',
    'relation',
  ];
  try {
    await asUser(db, A);
    await assert.rejects(rpc(db, 'create_project', args), /ACCESS_DENIED/);
    await asUser(db, O, 'authenticated', 'aal1');
    await assert.rejects(rpc(db, 'create_project', args), /MFA_REQUIRED/);
    await asUser(db, O, 'authenticated', 'aal2');
    await rpc(db, 'set_event_role', [B, 'organiser', true]);
    await asUser(db, B, 'authenticated', 'aal2');
    await assert.rejects(rpc(db, 'create_project', args), /OWNER_REQUIRED/);
    await asUser(db, O, 'authenticated', 'aal2');
    const id = await rpc<string>(db, 'create_project', args);
    const draft = await rpc(db, 'get_project_draft', [id]);
    assert.equal(draft.fields.title, 'Synthetic new work');
    assert.equal(draft.fields.permission, false);
    assert.equal(draft.metadata.room, null);
    assert.equal(draft.metadata.theme, 'relation');
    assert.equal(
      (await rpc<any[]>(db, 'get_people')).filter((p) => p.projectId === id)
        .length,
      0,
    );
    await rpc(db, 'set_membership', [id, A, true]);
    await asUser(db, A);
    await rpc(db, 'save_project_draft', [
      id,
      0,
      { ...draft.fields, title: 'Later participant edit' },
    ]);
    await asUser(db, O, 'authenticated', 'aal2');
    assert.equal(await rpc(db, 'create_project', args), id);
    assert.equal(
      (await rpc(db, 'get_project_draft', [id])).fields.title,
      'Later participant edit',
    );
    await assert.rejects(
      rpc(db, 'create_project', [
        request,
        'synthetic-new-work',
        'Different title',
        'Synthetic contributor',
        'relation',
      ]),
      /REQUEST_CONFLICT/,
    );
    await assert.rejects(
      rpc(db, 'create_project', [randomUUID(), ...args.slice(1)]),
      /PROJECT_IDENTIFIER_TAKEN/,
    );
    await assert.rejects(
      rpc(db, 'create_project', [
        randomUUID(),
        '../escape',
        'Title',
        'Name',
        'relation',
      ]),
      /INVALID_PROJECT_DETAILS/,
    );
    await assert.rejects(
      rpc(db, 'create_project', [
        randomUUID(),
        'invalid-markup',
        '<script>',
        'Name',
        'relation',
      ]),
      /INVALID_TEXT_FIELD/,
    );
    await db.exec('reset role');
    assert.equal(
      (await db.query('select * from editorial.project_creation_requests')).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query('select * from editorial.revisions')).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
