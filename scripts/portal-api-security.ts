import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import {
  localRuntime,
  fixtureJournal,
  fixtureSession,
  checked,
} from './portal-local-runtime.ts';
const r = localRuntime(),
  j = await fixtureJournal(),
  origin = 'http://127.0.0.1:4321';
let phase = 'sessions';
try {
  const a = await fixtureSession(r, j.users[0]),
    b = await fixtureSession(r, j.users[1]),
    owner = await fixtureSession(r, j.users[2], j.ownerFactor);
  const [pa, pb] = j.projects;
  await checked(
    owner.rpc('set_membership', {
      p_project: pa,
      p_user: j.users[0].id,
      p_active: true,
    }),
  );
  const aToken = (await checked(a.auth.getSession())).session.access_token,
    ownerToken = (await checked(owner.auth.getSession())).session.access_token;
  const deny = async (p: PromiseLike<any>) =>
    assert.ok((await p).error, 'Protected request unexpectedly allowed');
  phase = 'owner-aal1-denial';
  const ownerLow = await fixtureSession(r, j.users[2]);
  for (const [name, args] of [
    [
      'set_membership',
      { p_project: pa, p_user: j.users[0].id, p_active: false },
    ],
    ['prepare_release', { p_source_commit: 'a'.repeat(40), p_revisions: [] }],
    [
      'approve_and_queue_release',
      { p_release: randomUUID(), p_digest: 'a'.repeat(64) },
    ],
    [
      'decide_revision',
      {
        p_revision: randomUUID(),
        p_digest: 'a'.repeat(64),
        p_expected_version: 0,
        p_decision: 'approved',
        p_feedback: '',
        p_note: '',
      },
    ],
  ] as const) {
    const result = await ownerLow.rpc(name, args);
    assert.equal(result.error?.message, 'MFA_REQUIRED');
  }
  phase = 'metadata-role-injection';
  await checked(
    a.auth.updateUser({
      data: { role: 'owner', projectId: pb, is_admin: true },
    }),
  );
  assert.equal((await checked(a.rpc('portal_context'))).organiser, false);
  await deny(
    a.rpc('set_event_role', {
      p_user: j.users[0].id,
      p_role: 'owner',
      p_active: true,
    }),
  );
  await deny(a.rpc('get_event_administration'));
  phase = 'protected-fields-and-tables';
  const draft = await checked(a.rpc('get_project_draft', { p_project: pa }));
  for (const key of [
    'owner',
    'slug',
    'organiserRole',
    'eventTime',
    'approved',
    'published',
  ])
    await deny(
      a.rpc('save_project_draft', {
        p_project: pa,
        p_expected_version: draft.version,
        p_fields: { ...draft.fields, [key]: 'injected' },
      }),
    );
  for (const identity of [a, owner, r.client()])
    for (const table of [
      'drafts',
      'revisions',
      'prepared',
      'decisions',
      'releases',
      'memberships',
      'event_roles',
    ]) {
      const response = await fetch(`${r.url}/rest/v1/${table}?select=*`, {
        headers: {
          apikey: r.pub,
          Authorization: `Bearer ${(await identity.auth.getSession()).data.session?.access_token || r.pub}`,
          'Accept-Profile': 'editorial',
        },
      });
      assert.ok(response.status >= 400);
    }
  phase = 'raw-edge-denial';
  const endpoint = `${r.url}/functions/v1/`;
  for (const token of [r.pub, 'not-a-jwt', aToken]) {
    const response = await fetch(endpoint + 'provision-participant', {
      method: 'POST',
      headers: {
        apikey: r.pub,
        Authorization: `Bearer ${token}`,
        Origin: origin,
        'Content-Type': 'application/json',
        'x-email': 'owner@example.invalid',
      },
      body: JSON.stringify({
        requestId: randomUUID(),
        projectId: pb,
        email: `unapproved-${randomUUID()}@example.invalid`,
        sendInvitation: true,
      }),
    });
    assert.ok([401, 403].includes(response.status));
  }
  const noConsent = await fetch(endpoint + 'provision-participant', {
    method: 'POST',
    headers: {
      apikey: r.pub,
      Authorization: `Bearer ${ownerToken}`,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requestId: randomUUID(),
      projectId: pb,
      email: `unapproved-${randomUUID()}@example.invalid`,
    }),
  });
  assert.equal(noConsent.status, 400);
  for (const extra of [
    { repository: 'attacker/repo' },
    { ref: 'untrusted' },
    { command: 'arbitrary' },
  ]) {
    const response = await fetch(endpoint + 'dispatch-job', {
      method: 'POST',
      headers: {
        apikey: r.pub,
        Authorization: `Bearer ${aToken}`,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobId: randomUUID(), ...extra }),
    });
    assert.equal(response.status, 400);
  }
  phase = 'retained-jwt-revocation';
  const lastRevision = (await checked(a.rpc('get_my_projects')))[0]
    .latestRevision;
  await checked(
    owner.rpc('set_membership', {
      p_project: pa,
      p_user: j.users[0].id,
      p_active: false,
    }),
  );
  await deny(a.rpc('get_project_draft', { p_project: pa }));
  await deny(
    a.rpc('save_project_draft', {
      p_project: pa,
      p_expected_version: draft.version,
      p_fields: draft.fields,
    }),
  );
  await deny(
    a.rpc('reserve_upload', {
      p_project: pa,
      p_type: 'image/png',
      p_bytes: 10,
    }),
  );
  await deny(
    a.rpc('submit_project_revision', {
      p_project: pa,
      p_expected_version: draft.version,
      p_request: randomUUID(),
    }),
  );
  if (lastRevision)
    await deny(a.rpc('get_revision_preview', { p_revision: lastRevision }));
  assert.equal((await checked(b.rpc('get_my_projects'))).length, 1);
  assert.equal((await fetch(origin + '/')).status, 200);
  await checked(
    owner.rpc('set_membership', {
      p_project: pa,
      p_user: j.users[0].id,
      p_active: true,
    }),
  );
  await writeFile(
    'docs/evidence/portal/real-api-security.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        result: 'passed',
        scope: 'Real local low-privilege HTTP and Edge endpoints',
        checks: [
          'user_metadata role injection denied',
          'real owner AAL1 denied approval, queueing, release preparation and membership changes',
          'six protected draft keys denied',
          'private table schema unexposed for anonymous/participant/organiser',
          'Edge API-key/fake-token/participant privilege denial',
          'invitation requires explicit send consent',
          'dispatch rejects repository/ref/command overrides',
          'retained JWT cannot read/save/upload/submit/read revision after revocation',
          'B and public site remain available',
        ],
        notProven: [
          'remote environment configuration',
          'all Storage S3/copy/move surfaces',
        ],
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    'Real local API/Edge negative tests and retained-session revocation passed.\n',
  );
} catch (error) {
  process.stderr.write(
    `LOCAL_API_SECURITY_FAILED at ${phase}: ${(error as Error).message.split('\n')[0].slice(0, 120)}\n`,
  );
  process.exitCode = 1;
}
