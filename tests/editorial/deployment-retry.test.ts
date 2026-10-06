import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyDeploymentWithRetry } from '../../editorial/deployment.ts';

const revision = 'a'.repeat(64);
const bodies = new Map([
  ['content-revision.json', JSON.stringify({ revision })],
  ['index.html', '<h1>Approved public page</h1>'],
]);
const describe = (entries: Map<string, string>) => ({
  schemaVersion: 1, revision, origin: 'https://example.invalid/',
  files: [...entries].map(([path, body]) => ({ path, size: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') })),
});
const respond = (url: any, entries = bodies) => {
  const path = new URL(String(url)).pathname.slice(1) || 'index.html';
  return new Response(entries.get(path));
};

test('a transient stale page repeats the whole ordinary and fresh verification', async () => {
  const visits: string[] = [], waits: number[] = [];
  let stale = true;
  const result = await verifyDeploymentWithRetry(describe(bodies), async (url) => {
    visits.push(String(url));
    if (new URL(String(url)).pathname === '/' && stale) { stale = false; return new Response('old page'); }
    return respond(url);
  }, async (ms) => { waits.push(ms); });
  assert.equal(result.outcome, 'deployed-revision-verified');
  assert.deepEqual(waits, [5000]);
  assert.equal(visits.filter(url => new URL(url).pathname === '/content-revision.json').length, 3);
  assert.equal(visits.filter(url => new URL(url).searchParams.has('verify')).length, 2);
});

test('a starting reminder worker must eventually match both build and no-store header', async () => {
  const build = 'b'.repeat(64), worker = 'approved worker';
  const entries = new Map(bodies);
  entries.set('_worker.js', worker);
  entries.set('reminder-service.json', JSON.stringify({ revision, build, workerSha256: createHash('sha256').update(worker).digest('hex') }));
  const waits: number[] = [];
  let versions = 0;
  await verifyDeploymentWithRetry(describe(entries), async (url) => {
    if (new URL(String(url)).pathname === '/api/reminders/version') {
      versions++;
      return versions === 1 ? new Response('starting', { status: 503 }) : Response.json({ build }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return respond(url, entries);
  }, async ms => { waits.push(ms); });
  assert.deepEqual(waits, [5000]);
  assert.equal(versions, 3);
});

test('a persistent mismatch stops after four attempts and never returns a verified receipt', async () => {
  const waits: number[] = [];
  let attempts = 0;
  await assert.rejects(verifyDeploymentWithRetry(describe(bodies), async () => {
    attempts++; return new Response('wrong bytes');
  }, async ms => { waits.push(ms); }), /DEPLOYED_FILE_MISMATCH/);
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [5000, 10000, 15000]);
});

test('invalid release input is not retried or fetched', async () => {
  let fetches = 0, waits = 0;
  await assert.rejects(verifyDeploymentWithRetry({ ...describe(bodies), origin: 'http://127.0.0.1/' }, async () => {
    fetches++; return new Response('');
  }, async () => { waits++; }), /VALIDATION_FAILED/);
  assert.equal(fetches, 0); assert.equal(waits, 0);
});
