import { createServer } from 'node:http';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { readJson, within } from './store.ts';
import type { LivePointer } from './publisher.ts';

// This server exposes only verified synthetic publication generations, never the
// editorial store. It has no mutation endpoints or participant editing interface.
export function createPreviewServer(root: string) {
  return createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, headers).end();
      return;
    }
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(request.headers.host ?? '')) {
      response.writeHead(403, headers).end();
      return;
    }
    try {
      const pointer = (await readJson(join(root, 'live.json'))) as LivePointer;
      if (!/^[a-f0-9]{16}-[a-f0-9]{16}$/.test(pointer.active.directory))
        throw new Error('Invalid pointer');
      const decoded = decodeURIComponent(
        new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      );
      if (
        decoded.includes('\\') ||
        decoded.includes('\0') ||
        decoded.split('/').some((part) => part === '..' || part.startsWith('.'))
      ) {
        response.writeHead(404, headers).end();
        return;
      }
      let path = decoded.replace(/^\//, '');
      if (!path || path.endsWith('/')) path += 'index.html';
      else if (!extname(path)) {
        response
          .writeHead(308, {
            ...headers,
            Location: `${decoded}/${new URL(request.url ?? '/', 'http://127.0.0.1').search}`,
          })
          .end();
        return;
      }
      const exists = pointer.active.files.some((file) => file.path === path);
      const directory = join(root, 'publications', pointer.active.directory);
      const requested = within(directory, exists ? path : '404.html');
      const stat = await lstat(requested);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error('Invalid public file');
      if ((await realpath(requested)).toLowerCase() !== requested.toLowerCase())
        throw new Error('Invalid public path');
      const bytes = await readFile(requested);
      const expected = pointer.active.files.find(
        (file) => file.path === (exists ? path : '404.html'),
      );
      if (
        !expected ||
        createHash('sha256').update(bytes).digest('hex') !== expected.sha256
      )
        throw new Error('Public file changed after verification');
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp',
        '.txt': 'text/plain; charset=utf-8',
      };
      response.writeHead(exists ? 200 : 404, {
        ...headers,
        'Content-Type': types[extname(requested)] ?? 'application/octet-stream',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response
        .writeHead(503, {
          ...headers,
          'Content-Type': 'text/plain; charset=utf-8',
        })
        .end(
          'Local publication preview is not ready. The editorial store is not exposed.',
        );
    }
  });
}
