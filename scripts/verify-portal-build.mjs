import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve('portal-dist');
const expectedPages = [
  'index.html', '404.html', 'participants/index.html',
  'participant/index.html', 'participant/login/index.html',
  'participant/editor/index.html', 'participant/preview/index.html',
  'organiser/index.html', 'organiser/review/index.html',
  'organiser/releases/index.html', 'organiser/people/index.html',
];
async function walk(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Output may not contain symlinks');
    const path = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await walk(join(directory, entry.name), path + '/'));
    else result.push(path);
  }
  return result.sort();
}
const files = await walk(root);
assert.deepEqual(files.filter(x => x.endsWith('.html')).sort(), expectedPages.sort());
const manifest = [];
let combined = '';
for (const path of files) {
  assert(expectedPages.includes(path) || ['_headers', 'robots.txt', 'motion.css', 'grain.svg'].includes(path) || /^_astro\/[\w.-]+\.(css|js)$/.test(path), 'Unexpected output path');
  const bytes = await readFile(join(root, path));
  const text = bytes.toString('utf8');
  combined += text;
  assert(!/127\.0\.0\.1:54321|sb_secret_[A-Za-z0-9_-]{20,}|service_role.{0,10}eyJ|LOCAL PREVIEW|edit2=|editLinkSecret|ownerContact|7 August/i.test(text), 'Unapproved or private build content');
  if (path.endsWith('.html')) {
    assert.doesNotMatch(text, /Synthetic fixture|fixture-|sample-/i);
    assert.match(text, /noindex, nofollow/);
    assert.doesNotMatch(text, /href="\/(explore|visit|my-visit|projects)\//);
  }
  manifest.push({ path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
assert(combined.includes('https://audbvodildfpmschwyot.supabase.co'));
assert(combined.includes('sb_publishable_'));
assert(!files.some(x => x.endsWith('.map')));
const result = { kind: 'participant-workspace', verifiedAt: new Date().toISOString(), projectContentIncluded: false, files: manifest };
await mkdir('.portal-test', { recursive: true });
await writeFile('.portal-test/workspace-artifact.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ verified: true, htmlPages: expectedPages.length, files: files.length, projectContentIncluded: false }));
