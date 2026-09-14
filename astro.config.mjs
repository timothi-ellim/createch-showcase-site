import { defineConfig } from 'astro/config';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { readSnapshot, releaseBlockers } from './src/lib/content-schema.ts';

const isBuild = process.argv.includes('build');
const mode = process.argv[process.argv.indexOf('--mode') + 1];
const localMode = ['fixture-preview', 'editorial-preview'].includes(mode);
let site;
if (isBuild && !localMode) {
  if (
    !process.env.CREATECH_SNAPSHOT ||
    !process.env.CREATECH_RELEASE_APPROVAL
  ) {
    throw new Error(
      'RELEASE BLOCKED: approved public snapshot and revision-specific release approval are required. Use npm run build:local for the labelled local fixture preview.',
    );
  }
  const snapshot = readSnapshot(
    JSON.parse(readFileSync(process.env.CREATECH_SNAPSHOT, 'utf8')),
  );
  const blockers = releaseBlockers(snapshot);
  const approval = JSON.parse(
    readFileSync(process.env.CREATECH_RELEASE_APPROVAL, 'utf8'),
  );
  if (
    blockers.length ||
    approval.snapshotRevision !== snapshot.revision ||
    approval.authorised !== true ||
    !approval.approvedBy ||
    !Number.isFinite(Date.parse(approval.approvedAt))
  ) {
    throw new Error(
      `RELEASE BLOCKED: ${blockers.join(', ') || 'release approval does not match this exact snapshot'}`,
    );
  }
  site = snapshot.event.publicSiteUrl;
}
if (isBuild && mode === 'editorial-preview' && !process.env.CREATECH_SNAPSHOT)
  throw new Error('An editorial preview requires an exported snapshot.');
let outDir = localMode || !isBuild ? './local-dist' : './dist';
if (process.env.CREATECH_BUILD_DIR) {
  const base = resolve('.build-candidates');
  const output = resolve(process.env.CREATECH_BUILD_DIR);
  if (!/^[a-z0-9-]+[\\/]site$/.test(relative(base, output)))
    throw new Error('Unsafe candidate output path.');
  if (
    existsSync(output) &&
    realpathSync(output).toLowerCase() !== output.toLowerCase()
  )
    throw new Error('Build output cannot use a symlink.');
  outDir = output;
}
export default defineConfig({
  integrations: [
    {
      name: 'createch-hosting-headers',
      hooks: {
        'astro:config:setup': ({ injectRoute }) => {
          injectRoute({
            pattern: '/_headers',
            entrypoint: './src/lib/hosting-headers.ts',
            prerender: true,
          });
        },
      },
    },
  ],
  output: 'static',
  // The hosting CSP permits same-origin stylesheets, not inline style blocks.
  build: { inlineStylesheets: 'never' },
  outDir,
  site,
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1', port: 4321 },
  vite: { build: { sourcemap: false }, css: { postcss: { plugins: [] } } },
});
