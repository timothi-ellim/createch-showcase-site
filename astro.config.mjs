import { defineConfig } from 'astro/config';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { readSnapshot, releaseBlockers } from './src/lib/content-schema.ts';
import { freezeSnapshot } from './src/lib/content-schema.ts';
import { fileURLToPath } from 'node:url';
import { readReminderLaunchReceipt } from './editorial/reminder-launch.ts';

const isBuild = process.argv.includes('build');
const mode = process.argv[process.argv.indexOf('--mode') + 1];
const localMode = ['fixture-preview', 'editorial-preview', 'exhibition-preview'].includes(mode);
if (isBuild && !localMode && process.env.PUBLIC_REMINDERS_PREVIEW === 'true')
  throw new Error('Local reminder preview cannot be published.');
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
  if (process.env.PUBLIC_REMINDERS_ENABLED === 'true') {
    const receiptPath = process.env.CREATECH_REMINDERS_LAUNCH_RECEIPT;
    if (!receiptPath) throw new Error('Reminder launch receipt required.');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    readReminderLaunchReceipt(receipt, { revision: snapshot.revision, origin: new URL(site).origin });
  }
}
if (isBuild && ['editorial-preview', 'exhibition-preview'].includes(mode) && !process.env.CREATECH_SNAPSHOT)
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
      name: 'createch-project-signage',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const catalogue = JSON.parse(readFileSync('content/projects.json', 'utf8'));
          const snapshot = process.env.CREATECH_SNAPSHOT
            ? readSnapshot(JSON.parse(readFileSync(process.env.CREATECH_SNAPSHOT, 'utf8')))
            : freezeSnapshot({ schemaVersion: 2, publicationStatus: 'synthetic-local-only', event: JSON.parse(readFileSync('content/event.json', 'utf8')), themes: catalogue.themes, projects: catalogue.projects });
          const { generateSignage } = await import('./editorial/signage.ts');
          await generateSignage(fileURLToPath(dir), snapshot);
          if (process.env.PUBLIC_REMINDERS_ENABLED === 'true') {
            const { buildReminderWorker } = await import('./scripts/reminder-build.mjs');
            await buildReminderWorker(fileURLToPath(dir), snapshot.revision);
          }
        },
      },
    },
    {
      name: 'createch-hosting-headers',
      hooks: {
        'astro:config:setup': ({ injectRoute }) => {
          injectRoute({
            pattern: '/motion.css',
            entrypoint: './src/lib/motion/style.ts',
            prerender: true,
          });
          injectRoute({
            pattern: '/_headers',
            entrypoint: './src/lib/hosting-headers.ts',
            prerender: true,
          });
          injectRoute({
            pattern: '/_redirects',
            entrypoint: './src/lib/hosting-redirects.ts',
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
  // Small processed scripts must remain external under script-src 'self'.
  vite: {
    // Use the same explicit process flags for release gates, the worker and UI.
    // A Vite-loaded .env file must not silently enable an unreviewed public form.
    define: {
      'import.meta.env.PUBLIC_REMINDERS_ENABLED': JSON.stringify(process.env.PUBLIC_REMINDERS_ENABLED ?? 'false'),
      'import.meta.env.PUBLIC_REMINDERS_PREVIEW': JSON.stringify(process.env.PUBLIC_REMINDERS_PREVIEW ?? 'false'),
    },
    build: { sourcemap: false, assetsInlineLimit: 0 },
    css: { postcss: { plugins: [] } },
  },
});
