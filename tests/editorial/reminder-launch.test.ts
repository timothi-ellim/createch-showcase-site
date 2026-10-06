import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  prepareReminderLaunch,
  readReminderLaunchReceipt,
} from '../../editorial/reminder-launch.ts';
import { freezeSnapshot } from '../../src/lib/content-schema.ts';
import { verifyOutput } from '../../editorial/publisher.ts';
import {
  buildPortalCandidate,
  type WorkerAdapter,
} from '../../editorial/portal-worker.ts';
import type { PortalManifest } from '../../editorial/portal-validator.ts';
import { event, themes } from './helpers.ts';

const expected = {
  revision: 'a'.repeat(64),
  origin: 'https://reminders.example.invalid',
};
const approval = {
  snapshotRevision: expected.revision,
  origin: expected.origin,
  authorised: true,
  approvedBy: 'LOCAL AUTOMATED TEST ONLY',
  approvedAt: '2026-10-05T12:00:00Z',
  provider: 'gmail',
  privacyReviewed: true,
  deliveryVerified: true,
};

test('launch receipt requires exact event approval and rejects unreviewed or unexpected data', () => {
  assert.deepEqual(readReminderLaunchReceipt(approval, expected), approval);
  for (const change of [
    { snapshotRevision: 'b'.repeat(64) },
    { origin: 'https://elsewhere.example.invalid' },
    { authorised: false },
    { deliveryVerified: false },
    { privacyReviewed: false },
    { approvedBy: ' ' },
    { approvedAt: 'yesterday' },
    { provider: 'unselected' },
    { apiKey: 'PRIVATE_LAUNCH_SENTINEL' },
  ]) {
    assert.throws(
      () => readReminderLaunchReceipt({ ...approval, ...change }, expected),
      /^Error: REMINDER_LAUNCH_RECEIPT_MISMATCH$/,
    );
  }
});

test('publication materialises an existing receipt outside public output without minting permission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'createch-reminder-receipt-'));
  assert.equal(await prepareReminderLaunch(root, expected, {}), undefined);
  await assert.rejects(
    prepareReminderLaunch(root, expected, { PUBLIC_REMINDERS_ENABLED: 'true' }),
    /RECEIPT_REQUIRED/,
  );
  await assert.rejects(
    prepareReminderLaunch(root, expected, {
      PUBLIC_REMINDERS_ENABLED: 'true',
      CREATECH_REMINDERS_LAUNCH_RECEIPT_JSON: 'PRIVATE_LAUNCH_SENTINEL',
    }),
    /^Error: REMINDER_LAUNCH_RECEIPT_INVALID$/,
  );
  const env = {
    PUBLIC_REMINDERS_ENABLED: 'true',
    CREATECH_REMINDERS_LAUNCH_RECEIPT_JSON: JSON.stringify(approval),
  };
  await assert.rejects(
    prepareReminderLaunch(root, expected, {
      ...env,
      CREATECH_REMINDERS_LAUNCH_RECEIPT: 'irrelevant',
    }),
    /RECEIPT_AMBIGUOUS/,
  );
  const path = await prepareReminderLaunch(root, expected, env);
  assert.equal(path, join(root, 'reminder-launch.private.json'));
  assert.deepEqual(JSON.parse(await readFile(path!, 'utf8')), approval);
  await assert.rejects(prepareReminderLaunch(root, expected, env), /EEXIST/);
});

test(
  'approved reminder settings produce a real production-mode worker and form without exporting the receipt',
  { timeout: 120000 },
  async () => {
    // Reserved .invalid origin and synthetic approval. No network or deployment.
    const snapshot = freezeSnapshot({
      schemaVersion: 1,
      publicationStatus: 'approved-public',
      event: {
        ...event,
        programmeStatus: 'announcement',
        publicSiteUrl: expected.origin + '/',
        participants: [
          { projectId: 'reminder-test', name: 'Synthetic reminder test' },
        ],
      },
      themes,
      projects: [],
    });
    const manifest: PortalManifest = {
      schemaVersion: 1,
      releaseId: randomUUID(),
      sourceCommit: 'a'.repeat(40),
      environment: 'production',
      targetOrigin: expected.origin,
      targetId: 'synthetic-test',
      policyVersion: 1,
      eventVersion: 1,
      event: snapshot.event,
      themes: snapshot.themes,
      excludedAssets: [],
      excludedProjects: [],
      projects: [],
    };
    const unexpected = async (): Promise<never> => {
      throw new Error('This build must not access a hosted service');
    };
    const adapter: WorkerAdapter = {
      rpc: unexpected,
      download: unexpected,
      upload: unexpected,
    };
    const keys = [
      'PUBLIC_REMINDERS_ENABLED',
      'CREATECH_REMINDERS_LAUNCH_RECEIPT',
      'CREATECH_REMINDERS_LAUNCH_RECEIPT_JSON',
    ];
    const prior = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    );
    let built: Awaited<ReturnType<typeof buildPortalCandidate>>;
    try {
      process.env.PUBLIC_REMINDERS_ENABLED = 'true';
      delete process.env.CREATECH_REMINDERS_LAUNCH_RECEIPT;
      process.env.CREATECH_REMINDERS_LAUNCH_RECEIPT_JSON = JSON.stringify({
        ...approval,
        snapshotRevision: snapshot.revision,
      });
      built = await buildPortalCandidate(adapter, manifest, approval);
    } finally {
      for (const key of keys) {
        if (prior[key] === undefined) delete process.env[key];
        else process.env[key] = prior[key];
      }
    }
    const result = await verifyOutput(built!.site, snapshot, [
      'LOCAL AUTOMATED TEST ONLY',
      'PRIVATE_LAUNCH_SENTINEL',
    ]);
    assert.ok(result.files.some((f) => f.path === '_worker.js'));
    assert.ok(
      !result.files.some((f) => /private|approval|receipt/.test(f.path)),
    );
    const html = await readFile(
      join(built!.site, 'reminders/index.html'),
      'utf8',
    );
    assert.match(html, /action="\/api\/reminders\/subscribe"/);
    assert.doesNotMatch(
      html,
      /__mail|@example.invalid|LOCAL AUTOMATED TEST ONLY/,
    );
  },
);
