import { spawn } from 'node:child_process';
import { workerAdapter } from '../editorial/portal-worker.ts';
// Bounded queue processing, shared by the hosted schedule and manual recovery.
if (process.env.CREATECH_RECONCILIATION_ENABLED !== 'true')
  throw new Error('RECONCILIATION_NOT_ENABLED');
const adapter = workerAdapter();
await adapter.rpc('worker_reconcile');
const jobs = await adapter.rpc<string[]>('worker_queued');
let failures = 0;
for (const job of jobs) {
  if (!/^[a-f0-9-]{36}$/.test(job)) throw new Error('INVALID_JOB_ID');
  const succeeded = await new Promise<boolean>((resolve) => {
    const child = spawn(process.execPath, ['editorial/portal-worker.ts', job], {
      env: process.env,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
  if (!succeeded) failures++;
}
process.stdout.write(
  `Reconciliation complete: ${jobs.length} queued jobs considered; ${failures} failed.\n`,
);
if (failures) process.exitCode = 1;
