import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  ContentError,
  releaseBlockers,
  eventSchema,
  validate,
} from '../src/lib/content-schema.ts';
import {
  defaultStoreRoot,
  ensureStoreRoot,
  atomicJson,
  readJson,
  withStoreLock,
  repositoryRoot,
} from './store.ts';
import {
  createState,
  loadState,
  saveState,
  bindResponse,
  ingest,
  approve,
  withdraw,
  exportApproved,
  publicStatus,
  selectPreviousApproval,
  updateOrganiserFields,
} from './workflow.ts';
import {
  publishLocal,
  rollbackLocal,
  verifyRelease,
  runAstroBuild,
  verifyOutput,
  copyApprovedMedia,
} from './publisher.ts';
import type { LivePointer } from './publisher.ts';
import { createPreviewServer } from './server.ts';
import { fetchFormResponses } from './google-forms.ts';
import { approveMedia, mediaRegistry } from './media.ts';
import { runPilot } from './pilot.ts';
import { createDraftForm } from './form-setup.ts';
import { verifyDeployment } from './deployment.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string' },
    file: { type: 'string' },
    project: { type: 'string' },
    hash: { type: 'string' },
    by: { type: 'string' },
    artifact: { type: 'string' },
    port: { type: 'string' },
    alt: { type: 'string' },
    credit: { type: 'string' },
    approval: { type: 'string' },
    'permission-note': { type: 'string' },
  },
});
const command = positionals[0] ?? 'help';
const required = (name: keyof typeof values) => {
  const value = values[name];
  if (!value) throw new ContentError('MISSING_ARGUMENT', [name]);
  return value;
};
const print = (value: unknown) =>
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
async function actualRoot() {
  if (values.root) return await ensureStoreRoot(values.root);
  try {
    const latest = (await readJson(
      join(defaultStoreRoot(), 'latest-pilot.json'),
    )) as { root: string };
    return await ensureStoreRoot(latest.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return await ensureStoreRoot();
  }
}
async function main() {
  if (command === 'help') {
    print({
      commands: {
        pilot: 'Run the complete local synthetic pilot; no external services',
        serve: 'Serve only the latest verified local generation (--port 4323)',
        init: 'Initialise an empty private store from event/theme records (--root outside repository)',
        'create-form':
          'Create a separate unpublished Google Form using an explicitly supplied OAuth token; no sharing or invitations',
        'event-fields':
          'Update organiser-owned event fields from a full reviewed record (--file JSON); exact release approval is still required',
        bind: 'Bind a verified response to a project (--file private binding.json)',
        ingest:
          'Capture mapped response revisions (--file private response batch.json)',
        pull: 'Reconcile bounded Google Forms response pages (--file private config.json; GOOGLE_FORMS_ACCESS_TOKEN in environment)',
        status:
          'Show separate draft and approved states; no private contacts or response IDs',
        review: 'Show the candidate and exact hash (--project ID)',
        approve:
          'Approve the exact draft (--project ID --hash HASH --by ORGANISER)',
        'organiser-fields':
          'Change organiser-owned fields as a new draft (--project ID --file fields.json)',
        'approve-media':
          'Copy/approve a local image (--file PATH --alt TEXT --credit TEXT --by ORGANISER)',
        export: 'Write a public-only snapshot; does not build or activate',
        publish:
          'Build, verify and activate synthetic local output; never deploy publicly',
        withdraw:
          'Select withdrawal (--project ID --hash APPROVED_HASH); publish separately',
        'select-approval':
          'Select an earlier approved record (--project ID --hash HASH); publish separately',
        live: 'Verify active local files and show the actual served revision',
        rollback:
          'Restore an immutable verified local generation (--artifact HASH)',
        'release-check': 'List missing release content; no deployment',
        'prepare-release':
          'Build a release candidate only with exact release receipt (--approval FILE); no deployment',
        'verify-live':
          'Read the deployed assets and confirm their exact hashes (--file candidate.json); never initiates deployment',
      },
    });
    return;
  }
  if (command === 'pilot') {
    const result = await runPilot();
    print({
      outcome: 'local-pilot-complete',
      root: result.root,
      evidence: 'docs/evidence/editorial-pilot.json',
      checks: result.report.checks,
      activeRevision: result.report.activeRevision,
    });
    return;
  }
  const root = await actualRoot();
  if (command === 'serve') {
    const port = Number(values.port ?? '4323');
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new ContentError('INVALID_PORT');
    const pointer = (await readJson(join(root, 'live.json'))) as LivePointer;
    await verifyRelease(root, pointer.active);
    const server = createPreviewServer(root);
    server.on('error', () => {
      process.stderr.write('Local preview could not start; check the port.\n');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () =>
      print({
        localPreview: `http://127.0.0.1:${port}/`,
        scope: 'synthetic-only',
        revision: pointer.active.revision,
      }),
    );
    return;
  }
  await withStoreLock(root, async () => {
    if (command === 'verify-live') {
      const result = await verifyDeployment(await readJson(required('file')));
      await atomicJson(
        join(root, 'last-verified-deployment.private.json'),
        result,
      );
      print(result);
      return;
    }
    if (command === 'create-form') {
      print(
        await createDraftForm(
          root,
          process.env.GOOGLE_FORMS_ACCESS_TOKEN ?? '',
        ),
      );
      return;
    }
    if (command === 'init') {
      try {
        await access(join(root, 'state.json'));
        throw new ContentError('STORE_ALREADY_EXISTS');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const catalogue = JSON.parse(
        await readFile(join(repositoryRoot, 'content/projects.json'), 'utf8'),
      );
      const event = JSON.parse(
        await readFile(join(repositoryRoot, 'content/event.json'), 'utf8'),
      );
      const input = values.file
        ? ((await readJson(values.file)) as {
            event: unknown;
            themes: unknown;
            mode: 'synthetic-local-only' | 'approved-public';
          })
        : {
            event,
            themes: catalogue.themes,
            mode: 'synthetic-local-only' as const,
          };
      await saveState(root, createState(input.event, input.themes, input.mode));
      print({ outcome: 'empty-private-store-created', scope: input.mode });
      return;
    }
    const state = await loadState(root);
    if (command === 'event-fields') {
      state.event = validate(eventSchema, await readJson(required('file')));
      await saveState(root, state);
      print({ outcome: 'event-fields-updated; not built or activated' });
      return;
    }
    if (command === 'status') {
      print({
        scope: state.mode,
        projects: publicStatus(state),
        quarantinedResponses: state.quarantined.length,
      });
      return;
    }
    if (command === 'review') {
      const record = state.records[required('project')];
      if (!record) throw new ContentError('PROJECT_NOT_FOUND');
      print({
        projectId: record.organiser.id,
        draft: record.draft
          ? {
              revision: record.draft.revision,
              hash: record.draft.hash,
              candidate: record.draft.candidate,
              errors: record.draft.errors,
            }
          : null,
        approvedHash: record.selectedApproval,
      });
      return;
    }
    if (command === 'bind') {
      bindResponse(
        state,
        (await readJson(required('file'))) as Parameters<
          typeof bindResponse
        >[1],
      );
      await saveState(root, state);
      print({ outcome: 'response-bound', projects: publicStatus(state) });
      return;
    }
    if (command === 'ingest' || command === 'pull') {
      const batch =
        command === 'pull'
          ? await fetchFormResponses(
              await readJson(required('file')),
              process.env.GOOGLE_FORMS_ACCESS_TOKEN ?? '',
            )
          : await readJson(required('file'));
      if (!Array.isArray(batch) || batch.length > 2000)
        throw new ContentError('INVALID_INTAKE_BATCH');
      const results = batch.map((response) => ingest(state, response));
      await saveState(root, state);
      print({ outcome: 'drafts-reconciled', results });
      return;
    }
    if (command === 'approve') {
      approve(
        state,
        required('project'),
        required('hash'),
        required('by'),
        new Set((await mediaRegistry(root)).map((item) => item.src)),
        values['permission-note'] ?? '',
      );
      await saveState(root, state);
      print({
        outcome: 'exact-revision-approved; not yet built or active',
        projects: publicStatus(state),
      });
      return;
    }
    if (command === 'withdraw') {
      withdraw(state, required('project'), required('hash'));
      await saveState(root, state);
      print({
        outcome: 'withdrawal-selected; publish to remove the local page',
      });
      return;
    }
    if (command === 'select-approval') {
      selectPreviousApproval(state, required('project'), required('hash'));
      await saveState(root, state);
      print({ outcome: 'previous-approval-selected; publish separately' });
      return;
    }
    if (command === 'organiser-fields') {
      updateOrganiserFields(
        state,
        required('project'),
        await readJson(required('file')),
      );
      await saveState(root, state);
      print({
        outcome: 'organiser-fields-drafted; exact approval required',
        projects: publicStatus(state),
      });
      return;
    }
    if (command === 'approve-media') {
      print(
        await approveMedia(
          root,
          required('file'),
          required('alt'),
          required('credit'),
          required('by'),
        ),
      );
      return;
    }
    if (command === 'live') {
      const pointer = (await readJson(join(root, 'live.json'))) as LivePointer;
      await verifyRelease(root, pointer.active);
      print({
        scope: 'local-only',
        activeRevision: pointer.active.revision,
        artifactHash: pointer.active.artifactHash,
        verifiedAt: pointer.active.verifiedAt,
        previous: pointer.previous.map((item) => ({
          revision: item.revision,
          artifactHash: item.artifactHash,
        })),
      });
      return;
    }
    if (command === 'rollback') {
      const release = await rollbackLocal(root, required('artifact'));
      print({
        outcome: 'local-serving-pointer-rolled-back',
        revision: release.revision,
        note: 'Draft and approval selections are unchanged. Select earlier approvals before the next publish if the rollback should persist.',
      });
      return;
    }
    const snapshot = exportApproved(state);
    if (command === 'release-check') {
      print({
        revision: snapshot.revision,
        blockers: releaseBlockers(snapshot),
        externalConnections:
          'Google Forms live pilot, hosting setup and release approval still require verification',
      });
      return;
    }
    if (command === 'export') {
      const path = join(root, 'exports', `${snapshot.revision}.json`);
      await atomicJson(path, snapshot);
      print({
        outcome: 'public-only-snapshot-exported',
        path,
        revision: snapshot.revision,
      });
      return;
    }
    if (command === 'publish') {
      print({
        outcome: 'building-local-candidate',
        revision: snapshot.revision,
      });
      const privateValues = Object.values(state.records).flatMap((record) => [
        record.ownerContact,
        record.responseId,
        record.formId,
      ]);
      const result = await publishLocal(root, snapshot, {
        privateValues,
        mediaRoot: join(root, 'approved-media'),
      });
      print({
        outcome: result.outcome,
        revision: result.release.revision,
        artifactHash: result.release.artifactHash,
      });
      return;
    }
    if (command === 'prepare-release') {
      const blockers = releaseBlockers(snapshot);
      if (blockers.length) throw new ContentError('RELEASE_BLOCKED', blockers);
      const candidate = join(repositoryRoot, '.build-candidates', randomUUID());
      const input = join(candidate, 'snapshot.json');
      await atomicJson(input, snapshot);
      await runAstroBuild(
        input,
        join(candidate, 'site'),
        'production',
        resolve(required('approval')),
      );
      await copyApprovedMedia(
        snapshot,
        join(root, 'approved-media'),
        join(candidate, 'site'),
      );
      const verified = await verifyOutput(join(candidate, 'site'), snapshot);
      await atomicJson(join(candidate, 'candidate.json'), {
        schemaVersion: 1,
        revision: snapshot.revision,
        origin: snapshot.event.publicSiteUrl,
        files: verified.files,
      });
      print({
        outcome: 'release-candidate-built; not deployed',
        directory: join(candidate, 'site'),
        revision: snapshot.revision,
      });
      return;
    }
    throw new ContentError('UNKNOWN_COMMAND');
  });
}
main().catch((error) => {
  // Never log raw connector errors, response objects, URLs or bearer tokens.
  process.stderr.write(
    `${error instanceof ContentError ? error.message : 'EDITORIAL_OPERATION_FAILED: check local configuration and file permissions; no public activation was confirmed.'}\n`,
  );
  process.exitCode = 1;
});
