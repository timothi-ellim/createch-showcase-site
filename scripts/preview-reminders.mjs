// Loopback-only synthetic reminder service over real PostgreSQL migrations.
// Public project content comes from an already approved snapshot. No live mail.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname, relative } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { database, asUser, rpc, O } from '../tests/portal/database-harness.ts';
import { readSnapshot } from '../src/lib/content-schema.ts';
import { writeMediaDerivatives } from '../editorial/media-derivatives.ts';
import {
  reminderHandler,
  reminderHeaders,
} from '../editorial/reminders-http.ts';
import { deliverBatch, escape } from '../editorial/reminders.ts';

const root = resolve('.build-candidates/reminders-preview');
const output = resolve(root, 'site');
const origin = 'http://127.0.0.1:4339';
const source = resolve('.build-candidates/atlas-preview');
const snapshot = readSnapshot(
  JSON.parse(await readFile(resolve(source, 'snapshot.json'), 'utf8')),
);
if (snapshot.publicationStatus !== 'approved-public')
  throw new Error('APPROVED_PUBLIC_SNAPSHOT_REQUIRED');
await mkdir(root, { recursive: true });
const snapshotPath = resolve(root, 'snapshot.json');
await writeFile(snapshotPath, JSON.stringify(snapshot));
if (!process.argv.includes('--no-build')) {
  const env = {
    ...process.env,
    PATH: dirname(process.execPath) + ';' + process.env.PATH,
    CREATECH_SNAPSHOT: snapshotPath,
    CREATECH_BUILD_DIR: output,
    PUBLIC_REMINDERS_ENABLED: 'true',
    PUBLIC_REMINDERS_PREVIEW: 'true',
    ASTRO_TELEMETRY_DISABLED: '1',
  };
  delete env.CREATECH_RELEASE_APPROVAL;
  delete env.CREATECH_REMINDERS_LAUNCH_RECEIPT;
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/astro/bin/astro.mjs',
      'build',
      '--mode',
      'editorial-preview',
    ],
    { env, stdio: 'inherit', windowsHide: true },
  );
  if (result.status !== 0) process.exit(result.status || 1);
  const media = new Map();
  for (const p of snapshot.projects)
    for (const m of [p.media, ...p.processMedia]) if (m) media.set(m.src, m);
  for (const src of media.keys()) {
    const bytes = await readFile(resolve(source, 'site', '.' + src));
    const hash = src.match(/^\/media\/([a-f0-9]{64})\./)?.[1];
    if (!hash || createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error('PUBLIC_MEDIA_MISMATCH');
    const target = resolve(output, '.' + src);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    await writeMediaDerivatives(bytes, hash, output);
  }
}
if (process.argv.includes('--build-only')) process.exit(0);
const db = await database();
const secret = randomBytes(32).toString('hex');
const mails = [];
const call = (name, args = {}) => rpc(db, name, Object.values(args));
await asUser(db, null, 'service_role');
await call('reminder_configure', {
  event: snapshot.event,
  origin,
  revision: snapshot.revision,
  ready: true,
});
await asUser(db, O, 'authenticated', 'aal2');
await call('reminder_pause', { paused: false });
const handler = reminderHandler({
  rpc: call,
  secret,
  origin,
  enabled: true,
  local: true,
  source: () => 'loopback-synthetic-preview',
});
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.ics': 'text/calendar; charset=utf-8',
  '.xml': 'application/xml',
};
let queue = Promise.resolve();
const server = createServer((req, res) => {
  queue = queue
    .then(async () => {
      if (req.headers.host !== '127.0.0.1:4339') {
        res.writeHead(403);
        res.end();
        return;
      }
      const url = new URL(req.url, origin);
      let response;
      if (url.pathname.startsWith('/api/reminders/')) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2048) {
            res.writeHead(413);
            res.end();
            return;
          }
          chunks.push(chunk);
        }
        await asUser(db, null, 'service_role');
        response = await handler(
          new Request(url, {
            method: req.method,
            headers: req.headers,
            ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
          }),
        );
        await deliverBatch(call, secret, async (mail) => {
          mails.push(mail);
          return {
            status: 'accepted',
            providerId: `synthetic-capture-${mails.length}`,
          };
        });
      } else if (url.pathname === '/__mail.json') {
        response = Response.json(mails, { headers: reminderHeaders });
      } else if (url.pathname === '/__stats') {
        await asUser(db, O, 'authenticated', 'aal2');
        response = Response.json(await call('reminder_stats'), {
          headers: reminderHeaders,
        });
      } else if (url.pathname === '/__mail') {
        response = new Response(
          `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Synthetic local mailbox</title><link rel="stylesheet" href="/reminder-flow.css"><div class="wrap"><main class="reminder-page"><h1>Local test mailbox</h1><p>Only @example.invalid addresses. Nothing is sent. This test data resets when the preview restarts.</p><p><a href="/reminders/">Back to signup</a> · <a href="/__mail">Refresh mailbox</a></p>${mails.map((m) => `<article><p><strong>Captured for ${escape(m.to)}</strong></p>${m.html.replace(/<\/?(?:html|body)[^>]*>/g, '')}</article>`).join('<hr>') || '<p>No messages captured yet.</p>'}</main></div></html>`,
          {
            headers: {
              ...reminderHeaders,
              'Content-Type': 'text/html; charset=utf-8',
            },
          },
        );
      } else {
        let target = resolve(output, '.' + decodeURIComponent(url.pathname));
        if (
          relative(output, target).startsWith('..') ||
          url.pathname.startsWith('/_worker') ||
          url.pathname === '/_headers'
        ) {
          res.writeHead(404);
          res.end();
          return;
        }
        let code = 200;
        try {
          if ((await stat(target)).isDirectory())
            target = resolve(target, 'index.html');
          await stat(target);
        } catch {
          target = resolve(output, '404.html');
          code = 404;
        }
        response = new Response(await readFile(target), {
          status: code,
          headers: {
            ...reminderHeaders,
            'Content-Type': mime[extname(target)] ?? 'application/octet-stream',
          },
        });
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    })
    .catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Local preview error');
    });
});
server.listen(4339, '127.0.0.1', () =>
  console.log(
    `Reminder preview: ${origin}/reminders/ | Synthetic mailbox: ${origin}/__mail`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => db.close().then(() => process.exit(0))),
  );
