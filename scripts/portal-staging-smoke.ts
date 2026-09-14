import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const ref = 'audbvodildfpmschwyot';
assert.equal(
  (await readFile('supabase/.temp/project-ref', 'utf8')).trim(),
  ref,
);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/supabase/dist/supabase.js',
    'projects',
    'api-keys',
    '--project-ref',
    ref,
    '--output',
    'json',
  ],
  { encoding: 'utf8', windowsHide: true },
);
if (result.status !== 0) throw new Error('STAGING_PUBLIC_KEY_LOOKUP_FAILED');
const keys = JSON.parse(result.stdout);
const entries = Array.isArray(keys) ? keys : keys.api_keys;
const entry =
  entries?.find((x: any) => x.type === 'publishable') ??
  entries?.find((x: any) => x.name === 'anon');
const key = entry?.api_key;
if (!key) throw new Error('STAGING_PUBLIC_KEY_MISSING');
const url = `https://${ref}.supabase.co`;
const origin = 'https://createch-showcase-staging.pages.dev';
const checks: { name: string; status: number }[] = [];
async function request(
  name: string,
  path: string,
  init: RequestInit,
  allowed: number[],
) {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: key, ...init.headers },
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  assert.ok(
    allowed.includes(response.status),
    `${name}: unexpected HTTP ${response.status}`,
  );
  checks.push({ name, status: response.status });
  return response;
}
const settings = await (
  await request('Auth settings readable', '/auth/v1/settings', {}, [200])
).json();
assert.equal(settings.disable_signup, true);
assert.equal(settings.external?.email, true);
assert.equal(settings.external?.anonymous_users, false);
await request(
  'Private schema not exposed',
  '/rest/v1/settings?select=singleton',
  { headers: { 'Accept-Profile': 'editorial' } },
  [406],
);
await request(
  'Worker RPC rejects anonymous caller',
  '/rest/v1/rpc/worker_environment',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  },
  [401, 403, 404],
);
await request(
  'Private bucket has no public object route',
  '/storage/v1/object/public/source-uploads/createch-smoke-missing',
  {},
  [400, 403, 404],
);
for (const name of ['dispatch-job', 'provision-participant']) {
  const path = `/functions/v1/${name}`;
  const preflight = await request(
    `${name}: allowed-origin preflight`,
    path,
    { method: 'OPTIONS', headers: { Origin: origin } },
    [204],
  );
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  const wrong = await request(
    `${name}: wrong origin denied`,
    path,
    {
      method: 'POST',
      headers: {
        Origin: 'https://invalid.example',
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    [403],
  );
  assert.equal((await wrong.json()).code, 'ORIGIN_DENIED');
  const anonymous = await request(
    `${name}: missing login denied`,
    path,
    {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    },
    [401],
  );
  assert.equal((await anonymous.json()).code, 'SIGN_IN_REQUIRED');
  assert.equal(anonymous.headers.get('cache-control'), 'no-store');
}
await writeFile(
  'docs/evidence/portal/staging-smoke.json',
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      projectRef: ref,
      checks,
      limits:
        'No accounts, emails, participant records, jobs or site deployments created. Authenticated/MFA/SMTP/Cloudflare pilot not tested.',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `PASS: ${checks.length} hosted Auth/API/Storage/Edge checks; no keys printed.`,
);
