import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  database,
  asUser,
  rpc,
  A,
  B,
  O,
  PA,
  fields,
} from '../portal/database-harness';
import { mkdir, readFile } from 'node:fs/promises';
import { preparePortalRevision } from '../../editorial/portal-validator';
import { randomUUID } from 'node:crypto';

test('portal renders with the emitted hosting CSP enforced', async ({
  page,
}) => {
  const headersFile = await readFile(
    '.build-candidates/portal-browser/site/_headers',
    'utf8',
  );
  const policy = headersFile
    .split('/participant/*')[1]
    .match(/Content-Security-Policy: (.+)/)![1];
  await page.addInitScript(() => {
    (window as any).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as any).__cspViolations.push(event.violatedDirective);
    });
  });
  // Astro preview does not apply provider headers. Enforce the emitted value
  // in Chromium here; deployed Cloudflare header delivery remains a separate gate.
  await page.route('**/participant/login/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': policy },
    });
  });
  await page.goto('/participant/login/');
  await expect(page.locator('.invitation-choice')).toHaveCSS('display', 'flex');
  await expect(page.getByLabel('This is my first invitation code')).toHaveCSS(
    'width',
    '22px',
  );
  await expect(page.locator('style')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__cspViolations)).toEqual(
    [],
  );
});

// Auth/HTTP are explicitly controlled contracts; SQL executes the real migrations.
async function harness(page: Page, owner = false, signedIn = true) {
  const db = await database();
  await asUser(db, A);
  await rpc(db, 'save_project_draft', [PA, 0, fields]);
  let userId = owner ? O : A,
    saveFailure = false,
    expired = false;
  const token = () =>
    [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
        'base64url',
      ),
      Buffer.from(
        JSON.stringify({
          sub: userId,
          role: 'authenticated',
          aal: owner ? 'aal2' : 'aal1',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: 'http://127.0.0.1:54321/auth/v1',
          session_id: randomUUID(),
        }),
      ).toString('base64url'),
      'synthetic-only',
    ].join('.');
  const user = () => ({
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'synthetic@example.invalid',
    email_confirmed_at: '2026-09-14T00:00:00Z',
    created_at: '2026-09-14T00:00:00Z',
    app_metadata: {},
    user_metadata: {},
  });
  const session = () => ({
    access_token: token(),
    refresh_token: 'synthetic-test-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: user(),
  });
  if (signedIn)
    await page.addInitScript((session) => {
      sessionStorage.setItem('sb-127-auth-token', JSON.stringify(session));
    }, session());
  let pending = Promise.resolve();
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    const headers = {
      'access-control-allow-origin': 'http://127.0.0.1:4325',
      'access-control-allow-headers':
        'authorization,apikey,content-type,x-client-info,x-supabase-api-version',
      'content-type': 'application/json',
    };
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (path === '/auth/v1/user') {
      await route.fulfill({ json: user(), headers });
      return;
    }
    if (path === '/auth/v1/verify') {
      expired = false;
      await route.fulfill({ json: session(), headers });
      return;
    }
    if (path === '/auth/v1/otp') {
      await route.fulfill({ json: {}, headers });
      return;
    }
    if (path === '/auth/v1/logout') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (path.includes('/functions/')) {
      await route.fulfill({
        status: 503,
        json: { code: 'DISPATCH_UNAVAILABLE' },
        headers,
      });
      return;
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.split('/').at(-1)!;
      if (name === 'save_project_draft' && (saveFailure || expired)) {
        await route.fulfill({
          status: expired ? 401 : 503,
          json: {
            code: expired ? 'PGRST301' : 'OUTAGE',
            message: expired ? 'JWT expired' : 'Unavailable',
          },
          headers,
        });
        return;
      }
      const args = req.postDataJSON() || {};
      const run = async () => {
        try {
          await asUser(db, userId, 'authenticated', owner ? 'aal2' : 'aal1');
          const names = Object.keys(args);
          if (
            !/^[a-z_]+$/.test(name) ||
            names.some((n) => !/^p_[a-z_]+$/.test(n))
          )
            throw new Error('Invalid contract request');
          const result = await db.query<{ result: unknown }>(
            `select public.${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(',')}) as result`,
            Object.values(args),
          );
          await route.fulfill({ json: result.rows[0].result ?? null, headers });
        } catch (error) {
          await route.fulfill({
            status: 400,
            json: { code: 'P0001', message: (error as Error).message },
            headers,
          });
        }
      };
      pending = pending.then(run);
      await pending;
      return;
    }
    await route.fulfill({
      status: 404,
      json: { code: 'UNIMPLEMENTED_CONTRACT' },
      headers,
    });
  });
  return {
    db,
    failSave: (value: boolean) => {
      saveFailure = value;
    },
    expire: () => {
      expired = true;
    },
    switchUser: () => {
      userId = B;
    },
    close: async () => {
      await pending;
      await db.close();
    },
  };
}
test('participant saves, previews and submits through real SQL; later draft leaves prepared version intact', async ({
  page,
}) => {
  const h = await harness(page);
  try {
    await page.goto(`/participant/editor/?project=${PA}`);
    await expect(page.getByLabel('Project title', { exact: true })).toHaveValue(
      fields.title,
    );
    await page
      .getByLabel('About the work', { exact: true })
      .fill('Browser-edited synthetic description.');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.locator('[data-draft-preview]')).toContainText(
      'Browser-edited synthetic description.',
    );
    await page
      .getByRole('button', { name: 'Submit for review', exact: true })
      .click();
    await expect(page.locator('[data-submit-result]')).toContainText(
      'View this submitted version',
    );
    await asUser(h.db, A);
    const projects = await rpc(h.db, 'get_my_projects');
    const revision = projects[0].latestRevision;
    const preview = await rpc(h.db, 'get_revision_preview', [revision]);
    await asUser(h.db, null, 'service_role');
    const job = await rpc(h.db, 'worker_claim', [
      preview.jobId,
      'browser-contract',
    ]);
    const subject = await rpc(h.db, 'worker_subject', [
      job.jobId,
      job.attemptId,
    ]);
    const prepared = await preparePortalRevision(subject, async () => {
      throw new Error();
    });
    await rpc(h.db, 'worker_prepare', [
      job.jobId,
      job.attemptId,
      prepared.snapshot,
      prepared.digest,
      [],
      'a'.repeat(40),
    ]);
    await page
      .getByLabel('About the work', { exact: true })
      .fill('Pending later edit.');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Draft saved');
    await page.goto(`/participant/preview/?revision=${revision}`);
    await expect(page.locator('[data-project-body]')).toContainText(
      'Browser-edited synthetic description.',
    );
    await expect(page.locator('[data-project-body]')).not.toContainText(
      'Pending later edit.',
    );
  } finally {
    await h.close();
  }
});
test('failed save, optimistic conflict and inline session recovery preserve typed text', async ({
  page,
}) => {
  const h = await harness(page);
  try {
    await page.goto(`/participant/editor/?project=${PA}`);
    await page
      .getByLabel('Project title', { exact: true })
      .fill('Unsaved title retained');
    h.failSave(true);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('not saved');
    await expect(page.getByLabel('Project title', { exact: true })).toHaveValue(
      'Unsaved title retained',
    );
    await mkdir('docs/evidence/portal', { recursive: true });
    await page.screenshot({
      path: 'docs/evidence/portal/editor-save-failure.png',
      fullPage: true,
    });
    h.failSave(false);
    h.expire();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.locator('[data-login]')).toBeVisible();
    await page
      .getByLabel('Invited email address')
      .fill('synthetic@example.invalid');
    await page
      .getByRole('button', { name: 'Send email code', exact: true })
      .click();
    await page.getByLabel('Email code', { exact: true }).fill('123456');
    await page
      .getByRole('button', { name: 'Verify code', exact: true })
      .click();
    await expect(page.getByLabel('Project title', { exact: true })).toHaveValue(
      'Unsaved title retained',
    );
    await asUser(h.db, A);
    await rpc(h.db, 'save_project_draft', [
      PA,
      1,
      { ...fields, title: 'Saved elsewhere' },
    ]);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.locator('[data-conflict]')).toBeVisible();
    await expect(page.getByLabel('Project title', { exact: true })).toHaveValue(
      'Unsaved title retained',
    );
    await page.getByRole('button', { name: 'Compare saved draft' }).click();
    await expect(page.locator('[data-conflict-comparison]')).toContainText(
      'Saved elsewhere',
    );
  } finally {
    page.on('dialog', (d) => d.accept());
    await h.close();
  }
});
test('organiser approves exact revision and prepares a release; queued dispatch failure stays truthful', async ({
  page,
}) => {
  const h = await harness(page, true);
  try {
    await asUser(h.db, A);
    const sub = await rpc(h.db, 'submit_project_revision', [
      PA,
      1,
      randomUUID(),
    ]);
    await asUser(h.db, null, 'service_role');
    const job = await rpc(h.db, 'worker_claim', [
      sub.jobId,
      'browser-contract',
    ]);
    const prepared = await preparePortalRevision(
      await rpc(h.db, 'worker_subject', [sub.jobId, job.attemptId]),
      async () => {
        throw new Error();
      },
    );
    await rpc(h.db, 'worker_prepare', [
      job.jobId,
      job.attemptId,
      prepared.snapshot,
      prepared.digest,
      [],
      'a'.repeat(40),
    ]);
    await page.goto(`/organiser/review/?revision=${sub.revisionId}`);
    await expect(
      page.getByRole('heading', { name: 'Exact changes' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Approve this version', exact: true })
      .click();
    await expect(page.locator('[data-private-content]')).toContainText(
      'Approved · Awaiting publication',
    );
    await page.goto('/organiser/releases/');
    await page
      .getByLabel('Reviewed application version')
      .selectOption('a'.repeat(40));
    await page.getByRole('checkbox').check();
    await page
      .getByRole('button', { name: 'Prepare release for review' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Release 1', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Approve and queue this release' })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'not yet verified live',
    );
    await expect(page.locator('[data-private-content]')).not.toContainText(
      'Verified live',
    );
    await page.screenshot({
      path: 'docs/evidence/portal/release-queued-dispatch-failure.png',
      fullPage: true,
    });
  } finally {
    await h.close();
  }
});
test('all private routes stay accessible and fit four widths; screenshots use synthetic records only', async ({
  page,
}) => {
  test.setTimeout(90000);
  const h = await harness(page, true);
  try {
    const routes = [
      '/participant/',
      '/participant/login/',
      `/participant/editor/?project=${PA}`,
      '/organiser/',
      '/organiser/releases/',
      '/organiser/people/',
    ];
    for (const width of [320, 390, 768, 1440])
      for (const route of routes) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(route);
        await expect(page.locator('[data-private-content]')).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const result = await new AxeBuilder({ page }).analyze();
        expect(result.violations).toEqual([]);
        if (width === 390 || width === 1440)
          await page.screenshot({
            path: `docs/evidence/portal/${width}-${route.split('?')[0].replaceAll('/', '-')}.png`,
            fullPage: true,
          });
      }
    await page.emulateMedia({
      forcedColors: 'active',
      reducedMotion: 'reduce',
    });
    await page.goto(`/participant/editor/?project=${PA}`);
    await page.setViewportSize({ width: 390, height: 430 });
    await page.getByLabel('About the work', { exact: true }).focus();
    await expect(
      page.getByLabel('About the work', { exact: true }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await h.close();
  }
});

test('email code screen and explicit logout clear private DOM; another account cannot recover the previous project', async ({
  page,
}) => {
  const h = await harness(page, false, false);
  try {
    await page.goto('/participant/login/');
    await expect(page.locator('[data-login]')).toBeVisible();
    await page
      .getByLabel('Invited email address')
      .fill('synthetic@example.invalid');
    await page
      .getByRole('button', { name: 'Send email code', exact: true })
      .click();
    await expect(page.getByLabel('Email code', { exact: true })).toBeFocused();
    await expect(page.locator('[data-send-code]')).toBeDisabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: 'docs/evidence/portal/email-code-login.png',
      fullPage: true,
    });
    await page.getByLabel('Email code', { exact: true }).fill('123456');
    await page
      .getByRole('button', { name: 'Verify code', exact: true })
      .click();
    await expect(page).toHaveURL(/\/participant\/$/);
    await page.goto(`/participant/editor/?project=${PA}`);
    await expect(page.getByLabel('Project title', { exact: true })).toHaveValue(
      fields.title,
    );
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('[data-private-content]')).toBeEmpty();
    await expect(page.locator('[data-private-content]')).toBeHidden();
    expect(
      await page.evaluate(() => sessionStorage.getItem('sb-127-auth-token')),
    ).toBeNull();
    h.switchUser();
    await page
      .getByLabel('Invited email address')
      .fill('synthetic-b@example.invalid');
    await page
      .getByRole('button', { name: 'Send email code', exact: true })
      .click();
    await page.getByLabel('Email code', { exact: true }).fill('123456');
    await page
      .getByRole('button', { name: 'Verify code', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Access is unavailable',
    );
    await expect(page.locator('[data-private-content]')).not.toContainText(
      fields.title,
    );
  } finally {
    await h.close();
  }
});

test('organiser metadata and event updates are versioned; participant gets no administrative access', async ({
  page,
}) => {
  const h = await harness(page, true);
  try {
    await page.goto('/organiser/people/');
    await page
      .getByText('Project placement and access information', { exact: true })
      .click();
    await page.getByLabel('Project to update').selectOption(PA);
    await page
      .getByLabel('Confirmed project access notes')
      .fill('Synthetic test access note');
    await page
      .getByRole('button', { name: 'Save placement and access information' })
      .click();
    await expect(page.getByRole('status')).toContainText('fresh submission');
    await asUser(h.db, O, 'authenticated', 'aal2');
    expect((await rpc(h.db, 'get_project_draft', [PA])).metadataVersion).toBe(
      2,
    );
    await page
      .getByText('Event contact and visitor information', { exact: true })
      .click();
    await page
      .getByLabel('Public contact email', { exact: true })
      .fill('synthetic-contact@example.invalid');
    await page
      .getByRole('button', { name: 'Save event information for review' })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'public site has not changed',
    );
    await asUser(h.db, O, 'authenticated', 'aal2');
    expect(
      (await rpc(h.db, 'get_event_administration')).event.config.publicContact
        .email,
    ).toBe('synthetic-contact@example.invalid');
    await asUser(h.db, A);
    await expect(rpc(h.db, 'get_event_administration')).rejects.toThrow(
      'ACCESS_DENIED',
    );
  } finally {
    await h.close();
  }
});
