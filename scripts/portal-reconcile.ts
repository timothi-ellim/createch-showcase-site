import { spawn } from 'node:child_process';
import { workerAdapter } from '../editorial/portal-worker.ts';
// Manual, bounded recovery. The hosting schedule is intentionally not installed.
if (process.env.CREATECH_RECONCILIATION_ENABLED !== 'true')
  throw new Error('RECONCILIATION_NOT_ENABLED');
const adapter = workerAdapter();
await adapter.rpc('worker_reconcile');
const jobs = await adapter.rpc<string[]>('worker_queued');
for (const job of jobs) {
  if (!/^[a-f0-9-]{36}$/.test(job)) throw new Error('INVALID_JOB_ID');
  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, ['editorial/portal-worker.ts', job], {
      env: process.env,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}
process.stdout.write(
  `Reconciliation complete: ${jobs.length} queued jobs considered.\n`,
);
