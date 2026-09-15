import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

test('production build fails closed with an actionable release blocker', () => {
  const result = spawnSync(
    process.execPath,
    ['node_modules/astro/bin/astro.mjs', 'build'],
    {
      encoding: 'utf8',
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /RELEASE BLOCKED/);
});
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
test('local static output has no handoff references, secrets, or stale recruitment dates', () => {
  const paths = files('local-dist');
  assert.ok(paths.filter((path) => path.endsWith('.html')).length >= 10);
  assert.equal(
    paths.some((path) =>
      /reference|SOURCE_REGISTER|BUILD_BRIEF|\.map$/.test(path),
    ),
    false,
  );
  const output = paths
    .filter((path) => /\.(html|js|json|css)$/.test(path))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    output,
    /edit2=|responseId|editLinkSecret|ownerContact|1e1L8KAw|7 August|WS09|captions provided/i,
  );
  for (const path of paths.filter((path) => path.endsWith('.html'))) {
    const html = readFileSync(path, 'utf8');
    // September is the confirmed participant deadline, never the showcase date.
    const dateChecked = /[\\/]participants[\\/]index\.html$/.test(path)
      ? html.replaceAll('29 September 2026', 'CONFIRMED_PARTICIPANT_DEADLINE')
      : html;
    assert.doesNotMatch(dateChecked, /September 2026/i);
    assert.match(html, /noindex, nofollow/);
    if (!html.includes('data-page="private"')) assert.match(html, /LOCAL PREVIEW/);
    assert.match(html, /Wednesday 28 October 2026/);
  }
});
