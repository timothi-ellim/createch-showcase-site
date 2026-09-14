import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyDeployment } from '../../editorial/deployment.ts';

const revision = 'a'.repeat(64);
const manifest = JSON.stringify({ revision });
const files = [
  { path: 'content-revision.json', body: manifest },
  { path: 'index.html', body: '<h1>Synthetic verification fixture</h1>' },
  { path: '404.html', body: '<h1>Not found</h1>' },
];
const candidate = {
  schemaVersion: 1,
  revision,
  origin: 'https://example.invalid/',
  files: files.map(({ path, body }) => ({
    path,
    sha256: createHash('sha256').update(body).digest('hex'),
    size: Buffer.byteLength(body),
  })),
};
test('deployment status is verified only after matching all public file hashes and the revision', async () => {
  const fetcher = async (input: any) => {
    const path = new URL(String(input)).pathname;
    const file =
      path === '/'
        ? files[1]
        : path.startsWith('/__createch_missing_')
          ? files[2]
          : files[0];
    return new Response(file.body, {
      status: file.path === '404.html' ? 404 : 200,
    });
  };
  const result = await verifyDeployment(candidate, fetcher);
  assert.equal(result.outcome, 'deployed-revision-verified');
  assert.equal(result.checkedFiles, 3);
  assert.equal(result.revision, revision);
  await assert.rejects(
    verifyDeployment(candidate, async () => new Response('old output')),
    /DEPLOYED_FILE_MISMATCH/,
  );
  await assert.rejects(
    verifyDeployment(candidate, async () => new Response('', { status: 503 })),
    /DEPLOYMENT_NOT_VERIFIED/,
  );
  await assert.rejects(
    verifyDeployment({ ...candidate, origin: 'http://127.0.0.1/' }),
    /VALIDATION_FAILED/,
  );
});
