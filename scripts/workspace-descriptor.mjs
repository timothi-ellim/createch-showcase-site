import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export function workspaceDescriptor(path) {
  assert(path, 'Explicit workspace descriptor required');
  const d = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(d.version, 1);
  assert.equal(d.apiOrigin, 'https://audbvodildfpmschwyot.supabase.co');
  assert.equal(
    d.environment,
    'staging',
    'Keep the existing database environment honest',
  );
  assert.equal(d.publicOrigin, 'https://createch-showcase.pages.dev');
  assert.equal(d.legacyOrigin, 'https://createch-showcase-staging.pages.dev');
  assert.match(d.pagesProject, /^[a-z0-9][a-z0-9-]{2,50}$/);
  assert.equal(d.appOrigin, `https://${d.pagesProject}.pages.dev`);
  assert(![d.publicOrigin, d.legacyOrigin].includes(d.appOrigin));
  assert.equal(d.organiserAccess, true);
  assert(['candidate-not-deployed', 'approved'].includes(d.status));
  return d;
}
