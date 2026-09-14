// Real browser + real local Auth, SMTP capture, database, Storage and Edge runtime.
// No route interception. Synthetic fixtures only; no hosted deployment.
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  localRuntime,
  fixtureJournal,
  fixtureSession,
  checked,
  mailCode,
} from './portal-local-runtime.ts';
import {
  workerAdapter,
  runValidation,
  buildPortalCandidate,
} from '../editorial/portal-worker.ts';
const r = localRuntime(),
  j = await fixtureJournal(),
  origin = 'http://127.0.0.1:4321';
let phase = 'setup';
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
try {
  const owner = await fixtureSession(r, j.users[2], j.ownerFactor),
    session = (await checked(owner.auth.getSession())).session;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(
    (session) =>
      sessionStorage.setItem('sb-127-auth-token', JSON.stringify(session)),
    session,
  );
  const page = await context.newPage();
  phase = 'invite-through-organiser-ui';
  await page.goto(`${origin}/organiser/people/`);
  await expect(page.getByLabel('Approved recipient email')).toBeVisible();
  const email = `portal-browser-${randomUUID()}@example.invalid`,
    before = Date.now();
  await page.getByLabel('Approved recipient email').fill(email);
  await page.getByLabel('Assigned project').selectOption(j.projects[0]);
  await page
    .getByLabel(
      'I have checked this recipient and authorise sending the invitation',
    )
    .check();
  await page
    .getByRole('button', { name: 'Create access and send invitation' })
    .click();
  await expect(page.getByRole('status')).toContainText('invitation accepted', {
    timeout: 20000,
  });
  const invitation = await mailCode(r.mail, email, before);
  phase = 'first-invitation-browser-login';
  const visitorContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    participant = await visitorContext.newPage();
  await participant.goto(`${origin}/participant/login/`);
  await participant.getByLabel('Invited email address').fill(email);
  await participant.getByLabel('This is my first invitation code').check();
  await participant
    .getByLabel('Email code', { exact: true })
    .fill(invitation.code);
  await participant
    .getByRole('button', { name: 'Verify code', exact: true })
    .click();
  await expect(participant).toHaveURL(`${origin}/participant/`);
  phase = 'edit-save-upload-submit';
  await participant.goto(
    `${origin}/participant/editor/?project=${j.projects[0]}`,
  );
  await expect(
    participant.getByLabel('Project title', { exact: true }),
  ).toBeVisible();
  const title = `Synthetic real-service test ${randomUUID().slice(0, 8)}`;
  await participant.getByLabel('Project title', { exact: true }).fill(title);
  await participant
    .getByLabel('About the work', { exact: true })
    .fill(
      'Approved synthetic description from the real local browser workflow.',
    );
  const bytes = await sharp({
    create: { width: 120, height: 80, channels: 3, background: '#ebbeff' },
  })
    .png()
    .toBuffer();
  await participant.locator('#image-upload').setInputFiles({
    name: 'synthetic-rectangle.png',
    mimeType: 'image/png',
    buffer: bytes,
  });
  await expect(participant.getByRole('status')).toContainText(
    'Image uploaded privately',
  );
  await participant.locator('[name="alt"]').fill('A synthetic pink rectangle');
  await participant
    .locator('[name="credit"]')
    .fill('Local synthetic test image');
  await participant
    .getByRole('button', { name: 'Save draft', exact: true })
    .click();
  await expect(participant.getByRole('status')).toContainText('Draft saved');
  expect(
    (await new AxeBuilder({ page: participant }).analyze()).violations,
  ).toEqual([]);
  await participant.screenshot({
    path: 'docs/evidence/portal/real-services-editor.png',
    fullPage: true,
  });
  await participant
    .getByRole('button', { name: 'Submit for review', exact: true })
    .click();
  await expect(participant.locator('[data-submit-result]')).toContainText(
    'View this submitted version',
  );
  const previewLink = await participant
      .locator('[data-submit-result] a')
      .getAttribute('href'),
    revision = new URL(previewLink!, origin).searchParams.get('revision');
  const queued = await checked(
    owner.rpc('get_revision_preview', { p_revision: revision }),
  );
  expect(queued.jobStatus).toBe('queued');
  phase = 'real-node-validator';
  const source = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.trim();
  const adapter = workerAdapter({
    SUPABASE_URL: r.url,
    SUPABASE_SECRET_KEY: r.key,
    PORTAL_ENVIRONMENT: 'local',
    PORTAL_APP_ORIGIN: origin,
  });
  const job = await adapter.rpc<any>('worker_claim', {
    p_job: queued.jobId,
    p_run: 'real-local-browser',
  });
  await runValidation(adapter, job, source);
  await participant.goto(`${origin}${previewLink}`);
  await expect(participant.locator('[data-project-body]')).toContainText(title);
  await expect(participant.locator('[data-project-body] img')).toBeVisible();
  await participant.screenshot({
    path: 'docs/evidence/portal/real-services-prepared-preview.png',
    fullPage: true,
  });
  phase = 'organiser-review';
  await page.goto(`${origin}/organiser/review/?revision=${revision}`);
  await expect(
    page.getByRole('heading', { name: 'Exact changes' }),
  ).toBeVisible();
  await page
    .getByLabel('Private organiser note')
    .fill('REAL_SERVICE_PRIVATE_NOTE_CANARY');
  await page
    .getByRole('button', { name: 'Approve this version', exact: true })
    .click();
  await expect(page.locator('[data-private-content]')).toContainText(
    'Approved · Awaiting publication',
  );
  await page.screenshot({
    path: 'docs/evidence/portal/real-services-review.png',
    fullPage: true,
  });
  phase = 'pending-draft';
  await participant.goto(
    `${origin}/participant/editor/?project=${j.projects[0]}`,
  );
  await participant
    .getByLabel('About the work', { exact: true })
    .fill('REAL_SERVICE_PENDING_DRAFT_CANARY');
  await participant
    .getByRole('button', { name: 'Save draft', exact: true })
    .click();
  await expect(participant.getByRole('status')).toContainText('Draft saved');
  phase = 'approved-static-build';
  const b = await fixtureSession(r, j.users[1]),
    second = await checked(
      b.rpc('get_project_draft', { p_project: j.projects[1] }),
    );
  const secondFields = {
    ...second.fields,
    description:
      'Approved wording from the second independent local participant.',
  };
  await checked(
    b.rpc('save_project_draft', {
      p_project: j.projects[1],
      p_expected_version: second.version,
      p_fields: secondFields,
    }),
  );
  const secondSubmission = await checked(
    b.rpc('submit_project_revision', {
      p_project: j.projects[1],
      p_expected_version: second.version + 1,
      p_request: randomUUID(),
    }),
  );
  const secondJob = await adapter.rpc<any>('worker_claim', {
    p_job: secondSubmission.jobId,
    p_run: 'second-real-local-participant',
  });
  await runValidation(adapter, secondJob, source);
  const secondPreview = await checked(
    owner.rpc('get_revision_preview', {
      p_revision: secondSubmission.revisionId,
    }),
  );
  await checked(
    owner.rpc('decide_revision', {
      p_revision: secondSubmission.revisionId,
      p_digest: secondPreview.digest,
      p_expected_version: 0,
      p_decision: 'approved',
      p_feedback: '',
      p_note: '',
    }),
  );
  await checked(
    b.rpc('save_project_draft', {
      p_project: j.projects[1],
      p_expected_version: second.version + 1,
      p_fields: {
        ...secondFields,
        description: 'REAL_SERVICE_SECOND_PENDING_CANARY',
      },
    }),
  );
  await checked(owner.rpc('register_reviewed_source', { p_commit: source }));
  const release = await checked(
    owner.rpc('prepare_release', {
      p_source_commit: source,
      p_revisions: [revision, secondSubmission.revisionId],
    }),
  );
  const built = await buildPortalCandidate(adapter, release.manifest, {
    approvedAt: new Date().toISOString(),
    approvedBy: j.users[2].id,
  });
  expect(built.snapshot.projects[0].description).toBe(
    'Approved synthetic description from the real local browser workflow.',
  );
  expect(built.snapshot.projects.length).toBe(2);
  expect(built.snapshot.projects[1].description).toBe(
    'Approved wording from the second independent local participant.',
  );
  for (const file of built.files.filter((f) =>
    /\.(html|js|json|css)$/.test(f.path),
  )) {
    const text = await readFile(join(built.site, file.path), 'utf8');
    for (const canary of [
      email,
      'REAL_SERVICE_PENDING_DRAFT_CANARY',
      'REAL_SERVICE_PRIVATE_NOTE_CANARY',
      'REAL_SERVICE_SECOND_PENDING_CANARY',
      r.key,
    ])
      expect(text.includes(canary)).toBe(false);
  }
  phase = 'logout';
  await participant
    .getByRole('button', { name: 'Sign out', exact: true })
    .click();
  await expect(participant.locator('[data-private-content]')).toBeEmpty();
  await writeFile(
    'docs/evidence/portal/real-browser-integration.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        result: 'passed',
        scope:
          'Real local services; no HTTP mocks; synthetic identities/content only',
        checks: [
          'organiser MFA session',
          'explicit UI invitation through Edge runtime',
          'Mailpit invitation code',
          'first-invitation browser verification',
          'actual image upload/save/submit',
          'durable queued dispatch outage',
          'Node image validation and private prepared preview',
          'exact UI approval',
          'later draft remains private',
          'second independent participant saves/submits; both approvals built while both later drafts remain private',
          'approved-only actual Astro build and media verification',
          'private-data canary scan',
          'logout clearing',
        ],
        sourceBase: source,
        sourceWorkingTree:
          'Local test includes uncommitted implementation fixes; not a reviewed deployable release',
        artifactHash: built.artifactHash,
        contentRevision: built.snapshot.revision,
        notProven: [
          'external SMTP',
          'hosted deployment',
          'physical mobile device',
        ],
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    'Real local browser invitation -> edit/upload -> submit -> validate -> approve -> static build passed. No hosted deployment.\n',
  );
} catch (error) {
  process.stderr.write(
    `REAL_LOCAL_BROWSER_FAILED at ${phase}: ${(error as Error).message
      .split('\n')[0]
      .replace(/https?:\/\/\S+/g, '[URL]')
      .slice(0, 180)}\n`,
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
