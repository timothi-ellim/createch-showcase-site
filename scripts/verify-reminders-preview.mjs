// Read-only checks against the already-built local candidate and workerd.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyOutput } from '../editorial/publisher.ts';
import { readSnapshot } from '../src/lib/content-schema.ts';
const root = resolve('.build-candidates/reminders-preview');
const snapshot = readSnapshot(
  JSON.parse(await readFile(resolve(root, 'snapshot.json'), 'utf8')),
);
const verified = await verifyOutput(resolve(root, 'site'), snapshot, [
  'reminder-private-leak-sentinel',
  'failure@example.invalid',
]);
const receipt = JSON.parse(
  await readFile(resolve(root, 'site/reminder-service.json'), 'utf8'),
);
const origin = 'http://127.0.0.1:4341';
const version = await fetch(origin + '/api/reminders/version');
assert.equal(version.status, 200);
assert.equal(version.headers.get('cache-control'), 'no-store');
assert.equal((await version.json()).build, receipt.build);
const signup = await fetch(origin + '/api/reminders/subscribe', {
  method: 'POST',
  headers: {
    origin,
    'Content-Type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  },
  body: 'email=runtime%40example.invalid&consent=yes',
});
assert.equal(signup.status, 503, 'no configured service must fail closed');
assert.equal((await signup.json()).state, 'error');
assert.equal(signup.headers.get('cache-control'), 'no-store');
const webhook = await fetch(origin + '/api/reminders/webhook', {
  method: 'POST',
  body: '{}',
});
assert.equal(webhook.status, 400);
for (const path of ['/_worker.js', '/__mail', '/__stats']) {
  assert.equal(
    (await fetch(origin + path)).status,
    404,
    `${path} must never be a public asset`,
  );
}
assert.equal((await fetch(origin + '/reminders/')).status, 200);
const calendar = await fetch(origin + '/calendar/createch-showcase-2026.ics');
assert.equal(calendar.status, 200);
assert.match(await calendar.text(), /DTSTART:20261028T110000Z/);
const evidence = {
  checkedAt: new Date().toISOString(),
  environment: 'loopback Cloudflare workerd, no reminder service credentials',
  revision: snapshot.revision,
  artifactHash: verified.artifactHash,
  files: verified.files.length,
  workerBuild: receipt.build,
  checks: [
    'public output validation',
    'revision-bound worker receipt',
    'running worker fingerprint',
    'no-store API replies',
    '503 without reminder configuration',
    'unsigned webhook rejected',
    'worker and synthetic-only routes not public',
    'static signup page and calendar download',
  ],
  productionDeployment: false,
  externalEmail: false,
};
await mkdir('docs/evidence/reminders', { recursive: true });
await writeFile(
  'docs/evidence/reminders/local-runtime.json',
  JSON.stringify(evidence, null, 2) + '\n',
);
console.log(JSON.stringify(evidence));
