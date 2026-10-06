import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export async function buildReminderWorker(directory, revision) {
  const output = resolve(directory, '_worker.js');
  const compiledDirectory = resolve(directory, '..', 'reminder-worker');
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'pages',
      'functions',
      'build',
      'functions',
      '--outdir',
      compiledDirectory,
      '--minify',
      '--compatibility-date',
      '2026-09-11',
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        USERPROFILE: process.env.USERPROFILE,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        WRANGLER_SEND_METRICS: 'false',
      },
    },
  );
  if (result.status !== 0) throw new Error('REMINDER_WORKER_BUILD_FAILED');
  const source = await readFile(resolve(compiledDirectory, 'index.js'), 'utf8');
  if (!source.includes('__CREATECH_REMINDER_BUILD__'))
    throw new Error('REMINDER_BUILD_MARKER_MISSING');
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const build = hash(source);
  const worker = source.replaceAll('__CREATECH_REMINDER_BUILD__', build);
  await writeFile(output, worker);
  await writeFile(
    resolve(directory, '_routes.json'),
    JSON.stringify({ version: 1, include: ['/api/reminders/*'], exclude: [] }),
  );
  await writeFile(
    resolve(directory, 'reminder-service.json'),
    JSON.stringify({ revision, build, workerSha256: hash(worker) }),
  );
}
