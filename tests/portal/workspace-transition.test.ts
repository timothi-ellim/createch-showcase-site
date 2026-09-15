import test from 'node:test';
import assert from 'node:assert/strict';
import { appOrigins } from '../../supabase/functions/_shared/origins.ts';
import redirect from '../../deployment/legacy-workspace-worker.mjs';
import { workspaceDescriptor } from '../../scripts/workspace-descriptor.mjs';
test('transition origins are exact, expire, and never change the publication target', () => {
  const d = workspaceDescriptor('deployment/workspace-candidate.json');
  assert.equal(d.environment, 'staging');
  assert.deepEqual(appOrigins(d.appOrigin, d.legacyOrigin, '2026-11-01', 0), [
    d.appOrigin,
    d.legacyOrigin,
  ]);
  assert.deepEqual(
    appOrigins(
      d.appOrigin,
      d.legacyOrigin,
      '2026-11-01',
      Date.parse('2026-12-01'),
    ),
    [d.appOrigin],
  );
  assert.throws(() => appOrigins(d.appOrigin, '*', '2026-11-01'));
  assert.throws(() => appOrigins(d.appOrigin, d.legacyOrigin));
});
test('legacy redirect drops secrets and arbitrary destinations; organiser and previews delegate', async () => {
  const env = {
    PARTICIPANT_REDIRECT_ORIGIN: 'https://createch-workspace.pages.dev',
    ASSETS: { fetch: async () => new Response('existing-shell') },
  };
  for (const path of [
    '/participant',
    '/participant/',
    '/participant/login/',
    '/participant/editor/?email=synthetic&code=000000&next=https://evil.invalid',
  ]) {
    const r = await redirect.fetch(
      new Request('https://createch-showcase-staging.pages.dev' + path),
      env,
    );
    assert.equal(r.status, 302);
    assert.equal(
      r.headers.get('location'),
      'https://createch-workspace.pages.dev/participant/login/#',
    );
  }
  for (const url of [
    'https://createch-showcase-staging.pages.dev/organiser/',
    'https://preview.createch-showcase-staging.pages.dev/participant/',
  ])
    assert.equal(
      await (await redirect.fetch(new Request(url), env)).text(),
      'existing-shell',
    );
});
