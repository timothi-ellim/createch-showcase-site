// Isolated, synthetic browser-contract build. No real Supabase connection.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const env = {
  ...process.env,
  ASTRO_TELEMETRY_DISABLED: '1',
  ASTRO_PREVIEW_BACKGROUND: '1',
  CREATECH_BUILD_DIR: resolve(process.env.PORTAL_TEST_BUILD_DIR || '.build-candidates/portal-browser/site'),
  PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_contract_test',
  PUBLIC_PORTAL_ENVIRONMENT: 'local',
};
const build = spawn(
  process.execPath,
  ['node_modules/astro/bin/astro.mjs', 'build', '--mode', 'fixture-preview'],
  { env, stdio: 'inherit', windowsHide: true },
);
build.on('exit', (code) => {
  if (code !== 0) {
    process.exitCode = code || 1;
    return;
  }
  const server = spawn(
    process.execPath,
    [
      'node_modules/astro/bin/astro.mjs',
      'preview',
      '--mode',
      'fixture-preview',
      '--host',
      '127.0.0.1',
      '--port',
      process.env.PORTAL_TEST_PORT || '4325',
      '--ignore-lock',
    ],
    { env, stdio: 'inherit', windowsHide: true },
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.kill());
  server.on('exit', (c) => {
    process.exitCode = c || 0;
  });
});
