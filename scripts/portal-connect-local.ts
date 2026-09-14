import { readFile, writeFile } from 'node:fs/promises';
import { localRuntime } from './portal-local-runtime.ts';
const r = localRuntime();
const old = await readFile('.env.local', 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
if (old && !old.startsWith('# Managed synthetic local portal configuration'))
  throw new Error('EXISTING_LOCAL_ENV_PRESERVED');
await writeFile(
  '.env.local',
  `# Managed synthetic local portal configuration. Publishable key only.\nPUBLIC_SUPABASE_URL=${r.url}\nPUBLIC_SUPABASE_PUBLISHABLE_KEY=${r.pub}\nPUBLIC_PORTAL_ENVIRONMENT=local\n`,
  { mode: 0o600 },
);
process.stdout.write(
  'Configured the local portal with its loopback API and publishable key. No worker secret written. Rebuild the preview to apply.\n',
);
