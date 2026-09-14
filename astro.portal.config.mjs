import { defineConfig } from 'astro/config';

// A separate route tree lets invited people edit before a public catalogue is
// approved. This does not relax the public-release checks in astro.config.mjs.
const expectedApi = 'https://audbvodildfpmschwyot.supabase.co';
if (process.argv[process.argv.indexOf('--mode') + 1] !== 'portal-staging' ||
    process.env.PUBLIC_SUPABASE_URL !== expectedApi ||
    process.env.PUBLIC_PORTAL_ENVIRONMENT !== 'staging' ||
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '')) {
  throw new Error('PORTAL STAGING BUILD BLOCKED: exact hosted API, staging environment and publishable key required.');
}
export default defineConfig({
  srcDir: './portal-site',
  publicDir: './portal-site/public',
  outDir: './portal-dist',
  cacheDir: './node_modules/.astro-portal',
  site: 'https://createch-showcase-staging.pages.dev',
  output: 'static',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
  integrations: [{
    name: 'createch-standalone-workspace',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        for (const [pattern, entrypoint] of [
          ['/participant/[...path]', './src/pages/participant/[...path].astro'],
          ['/organiser/[...path]', './src/pages/organiser/[...path].astro'],
          ['/_headers', './src/lib/hosting-headers.ts'],
        ]) injectRoute({ pattern, entrypoint, prerender: true });
      },
    },
  }],
  vite: { build: { sourcemap: false }, css: { postcss: { plugins: [] } } },
});
