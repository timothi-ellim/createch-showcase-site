import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  ContentError,
  validate,
  eventSchema,
} from '../src/lib/content-schema.ts';
export const candidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    origin: eventSchema.shape.publicSiteUrl.unwrap(),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?\/)[a-zA-Z0-9_./-]+$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            size: z.number().int().min(0).max(20000000),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
  })
  .strict();
export async function verifyDeployment(
  value: unknown,
  fetcher: typeof fetch = fetch,
) {
  const candidate = validate(candidateSchema, value);
  if (!candidate.origin) throw new ContentError('PUBLIC_ORIGIN_REQUIRED');
  if (!candidate.files.some((file) => file.path === 'content-revision.json'))
    throw new ContentError('REVISION_MANIFEST_REQUIRED');
  const worker = candidate.files.find(file => file.path === '_worker.js');
  if (worker && !candidate.files.some(file => file.path === 'reminder-service.json'))
    throw new ContentError('REMINDER_RECEIPT_REQUIRED');
  // Check ordinary visitor URLs as well as an explicit fresh read. Cache-busted
  // success alone must never hide a stale canonical page.
  for (const fresh of [false, true])
    for (const file of candidate.files) {
      // Pages consumes these controls; they are not public downloadable files.
      if (['_headers', '_redirects', '_worker.js', '_routes.json'].includes(file.path)) continue;
      if (file.path.split('/').some((part) => part === '.' || part === '..'))
        throw new ContentError('INVALID_CANDIDATE_PATH');
      const url = new URL(
        file.path === '404.html'
          ? `__createch_missing_${candidate.revision.slice(0, 16)}/`
          : file.path.replace(/index\.html$/, ''),
        candidate.origin,
      );
      if (fresh)
        url.searchParams.set('verify', candidate.revision.slice(0, 16));
      let response: Response;
      try {
        response = await fetcher(url, {
          redirect: 'error',
          cache: fresh ? 'no-store' : 'default',
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new ContentError('DEPLOYMENT_NOT_VERIFIED', [file.path]);
      }
      if (file.path === '404.html' ? response.status !== 404 : !response.ok)
        throw new ContentError('DEPLOYMENT_NOT_VERIFIED', [
          file.path,
          `HTTP ${response.status}`,
        ]);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        bytes.length !== file.size ||
        createHash('sha256').update(bytes).digest('hex') !== file.sha256
      )
        throw new ContentError('DEPLOYED_FILE_MISMATCH', [file.path]);
      if (file.path === 'content-revision.json') {
        try {
          if (JSON.parse(bytes.toString()).revision !== candidate.revision)
            throw new Error();
        } catch {
          throw new ContentError('DEPLOYED_REVISION_MISMATCH');
        }
      }
      if (file.path === 'reminder-service.json') {
        const service = JSON.parse(bytes.toString());
        if (!worker || service.revision !== candidate.revision || service.workerSha256 !== worker.sha256 || !/^[a-f0-9]{64}$/.test(service.build))
          throw new ContentError('REMINDER_WORKER_MISMATCH');
        const response = await fetcher(new URL('/api/reminders/version', candidate.origin), {cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
        if (!response.ok || (await response.json()).build !== service.build || !response.headers.get('cache-control')?.includes('no-store'))
          throw new ContentError('REMINDER_WORKER_NOT_VERIFIED');
      }
    }
  return {
    outcome: 'deployed-revision-verified',
    revision: candidate.revision,
    origin: candidate.origin,
    verifiedAt: new Date().toISOString(),
    checkedFiles: candidate.files.length,
  };
}

// A new Pages deployment can briefly serve mixed static/worker versions.
// Retry the entire ordinary-and-fresh verification, never just the failed file.
export async function verifyDeploymentWithRetry(
  value: unknown,
  fetcher: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((done) => setTimeout(done, milliseconds)),
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await verifyDeployment(value, fetcher);
    } catch (error) {
      if (
        attempt >= 3 ||
        !(error instanceof ContentError) ||
        ![
          'DEPLOYMENT_NOT_VERIFIED',
          'DEPLOYED_FILE_MISMATCH',
          'REMINDER_WORKER_NOT_VERIFIED',
        ].includes(error.code)
      ) throw error;
      await wait(5000 * (attempt + 1));
    }
  }
}
