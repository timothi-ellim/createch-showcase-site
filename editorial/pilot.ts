import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validate, projectSchema } from '../src/lib/content-schema.ts';
import {
  createState,
  bindResponse,
  splitProject,
  ingest,
  approve,
  exportApproved,
  saveState,
  withdraw,
  selectPreviousApproval,
  publicStatus,
} from './workflow.ts';
import { publishLocal, rollbackLocal, verifyRelease } from './publisher.ts';
import {
  defaultStoreRoot,
  ensureStoreRoot,
  repositoryRoot,
  atomicJson,
  readJson,
} from './store.ts';
import { createPreviewServer } from './server.ts';

export async function runPilot() {
  const root = await ensureStoreRoot(
    join(defaultStoreRoot(), 'scenarios', randomUUID()),
  );
  const catalogue = JSON.parse(
    await readFile(join(repositoryRoot, 'content/projects.json'), 'utf8'),
  );
  const event = JSON.parse(
    await readFile(join(repositoryRoot, 'content/event.json'), 'utf8'),
  );
  const state = createState(event, catalogue.themes);
  const fixtures = catalogue.projects
    .slice(0, 2)
    .map((value: unknown) => validate(projectSchema, value));
  const formId = `synthetic-form-${randomUUID()}`;
  const checks: { task: string; outcome: string }[] = [];
  const at = (minute: number) =>
    new Date(Date.UTC(2026, 8, 13, 10, minute)).toISOString();
  for (const [index, project] of fixtures.entries()) {
    const { organiser, profile } = splitProject(project);
    const responseId = `synthetic-response-${randomUUID()}`;
    bindResponse(state, {
      organiser,
      formId,
      responseId,
      ownerContact: `synthetic-${index}@example.invalid`,
    });
    const intake = {
      formId,
      responseId,
      profile,
      observedAt: at(1),
      lastSubmittedAt: at(0),
    };
    ingest(state, intake);
    if (ingest(state, intake).outcome !== 'unchanged')
      throw new Error('Pilot idempotency failed');
    approve(
      state,
      project.id,
      state.records[project.id].draft!.hash,
      'Local synthetic organiser',
    );
  }
  checks.push({
    task: 'Two mapped contributors; repeated intake is idempotent; exact revision approval',
    outcome: 'passed',
  });
  await saveState(root, state);
  const first = await publishLocal(root, exportApproved(state));
  checks.push({
    task: 'Public-only snapshot → real Astro build → verified local activation',
    outcome: 'passed',
  });
  const record = state.records[fixtures[0].id];
  const edited = {
    ...splitProject(fixtures[0]).profile,
    invitation:
      'Synthetic revision two: an updated invitation for this local preview.',
  };
  ingest(state, {
    formId,
    responseId: record.responseId,
    profile: edited,
    observedAt: at(3),
    lastSubmittedAt: at(2),
  });
  if ((await publishLocal(root, exportApproved(state))).outcome !== 'unchanged')
    throw new Error('Pending edit changed live revision');
  checks.push({
    task: 'Later edit remains pending; previous approved page stays active',
    outcome: 'passed',
  });
  approve(
    state,
    fixtures[0].id,
    record.draft!.hash,
    'Local synthetic organiser',
  );
  const approvedSecond = exportApproved(state);
  try {
    await publishLocal(root, approvedSecond, {
      build: async () => {
        throw new Error('Simulated build failure');
      },
    });
    throw new Error('Failure simulation unexpectedly succeeded');
  } catch (error) {
    if ((error as Error).message !== 'Simulated build failure') throw error;
  }
  const afterFailure = (await readJson(join(root, 'live.json'))) as {
    active: { revision: string };
  };
  if (afterFailure.active.revision !== first.release.revision)
    throw new Error('Failed build changed live pointer');
  checks.push({
    task: 'Simulated build failure preserves previous live generation',
    outcome: 'passed',
  });
  const second = await publishLocal(root, approvedSecond);
  withdraw(
    state,
    fixtures[1].id,
    state.records[fixtures[1].id].selectedApproval!,
  );
  const removed = await publishLocal(root, exportApproved(state));
  const server = createPreviewServer(root);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    if (
      (await fetch(`http://127.0.0.1:${port}/projects/${fixtures[1].slug}/`))
        .status !== 404
    )
      throw new Error('Withdrawn page still available');
    checks.push({
      task: 'Withdrawal builds a new generation; removed project route returns 404',
      outcome: 'passed',
    });
    await rollbackLocal(root, second.release.artifactHash);
    if (
      (
        await fetch(`http://127.0.0.1:${port}/content-revision.json`).then(
          (response) => response.json(),
        )
      ).revision !== second.release.revision
    )
      throw new Error('Rollback not observable');
    checks.push({
      task: 'Rollback verifies immutable artifacts and restores served revision',
      outcome: 'passed',
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  selectPreviousApproval(
    state,
    fixtures[1].id,
    state.records[fixtures[1].id].selectedApproval!,
  );
  // Leave a meaningful pending edit for the organiser to review without publishing it.
  ingest(state, {
    formId,
    responseId: record.responseId,
    profile: {
      ...edited,
      invitation:
        'Synthetic revision three: review this pending change before approving it.',
    },
    observedAt: at(5),
    lastSubmittedAt: at(4),
  });
  await saveState(root, state);
  await verifyRelease(root, second.release);
  await atomicJson(join(defaultStoreRoot(), 'latest-pilot.json'), { root });
  const report = {
    executedAt: new Date().toISOString(),
    scope: 'Local synthetic pipeline; no real Google Form or public deployment',
    checks,
    activeRevision: second.release.revision,
    previousRevisions: [first.release.revision, removed.release.revision],
    projects: publicStatus(state),
  };
  await atomicJson(
    join(repositoryRoot, 'docs/evidence/editorial-pilot.json'),
    report,
  );
  return { root, report };
}
