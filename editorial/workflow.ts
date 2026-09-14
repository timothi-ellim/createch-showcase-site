import { join } from 'node:path';
import { z } from 'zod';
import {
  ContentError,
  validate,
  digest,
  profileSchema,
  organiserSchema,
  projectSchema,
  snapshotPayloadSchema,
  freezeSnapshot,
} from '../src/lib/content-schema.ts';
import type {
  PublicProfile,
  PublicProject,
  OrganiserFields,
  PublicSnapshot,
  SnapshotPayload,
} from '../src/lib/content-schema.ts';
import { atomicJson, readJson } from './store.ts';

export interface IntakeResponse {
  formId: string;
  responseId: string;
  observedAt: string;
  lastSubmittedAt: string;
  profile: unknown;
}
export interface Draft {
  revision: number;
  hash: string;
  candidate: PublicProject | null;
  errors: string[];
  observedAt: string;
  lastSubmittedAt: string;
  inputHash: string;
}
export interface Approval {
  hash: string;
  draftRevision: number;
  project: PublicProject;
  approvedAt: string;
  approvedBy: string;
  permissionNote: string;
}
export interface EditorialRecord {
  organiser: OrganiserFields;
  // These fields never cross the public-schema boundary.
  ownerContact: string;
  formId: string;
  responseId: string;
  draft: Draft | null;
  approvals: Approval[];
  selectedApproval: string | null;
  withdrawn: boolean;
}
export interface EditorialState {
  schemaVersion: 1;
  mode: 'synthetic-local-only' | 'approved-public';
  event: SnapshotPayload['event'];
  themes: SnapshotPayload['themes'];
  records: Record<string, EditorialRecord>;
  quarantined: { referenceHash: string; reason: string; observedAt: string }[];
  audit: {
    action: string;
    projectId: string | null;
    revision: string | null;
    at: string;
  }[];
}
const envelopeSchema = z
  .object({
    formId: z.string().min(3).max(300),
    responseId: z.string().min(3).max(300),
    observedAt: z.iso.datetime(),
    lastSubmittedAt: z.iso.datetime(),
    profile: z.unknown(),
  })
  .strict();
export function createState(
  event: unknown,
  themes: unknown,
  mode: EditorialState['mode'] = 'synthetic-local-only',
): EditorialState {
  const checked = validate(snapshotPayloadSchema, {
    schemaVersion: 1,
    publicationStatus: mode,
    event,
    themes,
    projects: [],
  });
  return {
    schemaVersion: 1,
    mode,
    event: checked.event,
    themes: checked.themes,
    records: {},
    quarantined: [],
    audit: [],
  };
}
function audit(
  state: EditorialState,
  action: string,
  projectId: string | null,
  revision: string | null,
) {
  state.audit.push({
    action,
    projectId,
    revision,
    at: new Date().toISOString(),
  });
}
export function bindResponse(
  state: EditorialState,
  binding: {
    organiser: unknown;
    ownerContact: string;
    formId: string;
    responseId: string;
  },
) {
  const organiser = validate(organiserSchema, binding.organiser);
  if (!binding.ownerContact || !binding.formId || !binding.responseId)
    throw new ContentError('BINDING_REQUIRES_VERIFIED_OWNER_AND_RESPONSE');
  if (
    Object.hasOwn(state.records, organiser.id) ||
    Object.values(state.records).some(
      (record) =>
        (record.formId === binding.formId &&
          record.responseId === binding.responseId) ||
        record.organiser.slug === organiser.slug,
    )
  )
    throw new ContentError('BINDING_ALREADY_EXISTS');
  state.records[organiser.id] = {
    organiser,
    ownerContact: binding.ownerContact,
    formId: binding.formId,
    responseId: binding.responseId,
    draft: null,
    approvals: [],
    selectedApproval: null,
    withdrawn: false,
  };
  audit(state, 'response-bound', organiser.id, null);
}
export function ingest(state: EditorialState, value: unknown) {
  const incoming = validate(envelopeSchema, value);
  const record = Object.values(state.records).find(
    (record) =>
      record.formId === incoming.formId &&
      record.responseId === incoming.responseId,
  );
  if (!record) {
    const referenceHash = digest({
      formId: incoming.formId,
      responseId: incoming.responseId,
    });
    if (
      !state.quarantined.some((entry) => entry.referenceHash === referenceHash)
    )
      state.quarantined.push({
        referenceHash,
        reason: 'UNBOUND_RESPONSE',
        observedAt: incoming.observedAt,
      });
    return { outcome: 'quarantined', projectId: null };
  }
  const inputHash = digest(incoming.profile);
  if (record.draft && incoming.observedAt < record.draft.observedAt)
    return { outcome: 'stale-observation', projectId: record.organiser.id };
  if (record.draft && incoming.lastSubmittedAt < record.draft.lastSubmittedAt)
    return { outcome: 'stale-response', projectId: record.organiser.id };
  if (record.draft?.inputHash === inputHash)
    return { outcome: 'unchanged', projectId: record.organiser.id };
  if (record.draft && incoming.observedAt === record.draft.observedAt)
    throw new ContentError('CONFLICTING_OBSERVATION');
  let candidate: PublicProject | null = null;
  let errors: string[] = [];
  try {
    const profile = validate(profileSchema, incoming.profile);
    candidate = validate(projectSchema, {
      ...profile,
      ...record.organiser,
      approvedRevision: null,
    });
    assertNoPrivateValues(candidate, state);
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    errors = [error.code, ...error.fields];
  }
  const hash = candidate ? digest(candidate) : digest({ inputHash, errors });
  record.draft = {
    revision: (record.draft?.revision ?? 0) + 1,
    hash,
    candidate,
    errors,
    observedAt: incoming.observedAt,
    lastSubmittedAt: incoming.lastSubmittedAt,
    inputHash,
  };
  audit(
    state,
    errors.length ? 'draft-invalid' : 'draft-captured',
    record.organiser.id,
    hash,
  );
  return {
    outcome: errors.length ? 'validation-failed' : 'draft-captured',
    projectId: record.organiser.id,
    hash,
  };
}
export function approve(
  state: EditorialState,
  projectId: string,
  expectedHash: string,
  approver: string,
  mediaPaths = new Set<string>(),
  permissionNote = '',
) {
  const record = state.records[projectId];
  if (!record?.draft?.candidate || record.draft.errors.length)
    throw new ContentError('NO_VALID_DRAFT');
  if (record.draft.hash !== expectedHash)
    throw new ContentError('STALE_APPROVAL');
  if (!approver.trim()) throw new ContentError('APPROVER_REQUIRED');
  if (state.mode === 'approved-public' && permissionNote.trim().length < 8)
    throw new ContentError('PUBLIC_PERMISSION_EVIDENCE_REQUIRED');
  const candidate = validate(projectSchema, record.draft.candidate);
  if (digest(candidate) !== expectedHash)
    throw new ContentError('DRAFT_HASH_MISMATCH');
  for (const media of [candidate.media, ...candidate.processMedia])
    if (media && !mediaPaths.has(media.src))
      throw new ContentError('MEDIA_NOT_APPROVED');
  assertNoPrivateValues(candidate, state);
  if (!record.approvals.some((approval) => approval.hash === expectedHash)) {
    record.approvals.push({
      hash: expectedHash,
      draftRevision: record.draft.revision,
      project: structuredClone({
        ...candidate,
        approvedRevision: expectedHash,
      }),
      approvedAt: new Date().toISOString(),
      approvedBy: approver,
      permissionNote:
        permissionNote.trim() ||
        'Synthetic local test; no real participant consent implied.',
    });
  }
  record.selectedApproval = expectedHash;
  record.withdrawn = false;
  audit(state, 'revision-approved', projectId, expectedHash);
}
export function selectPreviousApproval(
  state: EditorialState,
  projectId: string,
  hash: string,
) {
  const record = state.records[projectId];
  if (!record?.approvals.some((approval) => approval.hash === hash))
    throw new ContentError('APPROVAL_NOT_FOUND');
  record.selectedApproval = hash;
  record.withdrawn = false;
  audit(state, 'previous-approval-selected', projectId, hash);
}
export function withdraw(
  state: EditorialState,
  projectId: string,
  expectedHash: string,
) {
  const record = state.records[projectId];
  if (!record || record.selectedApproval !== expectedHash)
    throw new ContentError('STALE_WITHDRAWAL');
  record.withdrawn = true;
  audit(state, 'withdrawal-approved', projectId, expectedHash);
}
export function updateOrganiserFields(
  state: EditorialState,
  projectId: string,
  values: unknown,
) {
  const record = state.records[projectId];
  if (!record) throw new ContentError('PROJECT_NOT_FOUND');
  const next = validate(organiserSchema, values);
  if (next.id !== record.organiser.id || next.slug !== record.organiser.slug)
    throw new ContentError('STABLE_IDENTITY_CANNOT_CHANGE');
  record.organiser = next;
  if (record.draft?.candidate) {
    record.draft.candidate = { ...record.draft.candidate, ...next };
    record.draft.revision++;
    record.draft.hash = digest(record.draft.candidate);
  }
  audit(
    state,
    'organiser-fields-edited',
    projectId,
    record.draft?.hash ?? null,
  );
}
export function assertNoPrivateValues(
  publicValue: unknown,
  state: EditorialState,
) {
  const serialized = JSON.stringify(publicValue).toLowerCase();
  for (const record of Object.values(state.records)) {
    for (const secret of [
      record.ownerContact,
      record.responseId,
      record.formId,
    ])
      if (secret.length >= 6 && serialized.includes(secret.toLowerCase()))
        throw new ContentError('PRIVATE_VALUE_IN_PUBLIC_CONTENT');
  }
}
export function exportApproved(state: EditorialState): PublicSnapshot {
  const projects = Object.values(state.records)
    .filter((record) => !record.withdrawn && record.selectedApproval)
    .map((record) => {
      const approval = record.approvals.find(
        (item) => item.hash === record.selectedApproval,
      );
      if (!approval) throw new ContentError('APPROVAL_NOT_FOUND');
      const { approvedRevision, ...candidate } = validate(
        projectSchema,
        approval.project,
      );
      if (
        digest({ ...candidate, approvedRevision: null }) !== approval.hash ||
        approvedRevision !== approval.hash
      )
        throw new ContentError('APPROVAL_HASH_MISMATCH');
      return structuredClone(approval.project);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const snapshot = freezeSnapshot({
    schemaVersion: 1,
    publicationStatus: state.mode,
    event: state.event,
    themes: state.themes,
    projects,
  });
  assertNoPrivateValues(snapshot, state);
  return snapshot;
}
export function publicStatus(state: EditorialState) {
  return Object.values(state.records).map((record) => ({
    id: record.organiser.id,
    slug: record.organiser.slug,
    draftRevision: record.draft?.revision ?? null,
    draftHash: record.draft?.hash ?? null,
    validationErrors: record.draft?.errors ?? [],
    approvedHash: record.selectedApproval,
    pendingChanges: Boolean(
      record.draft && record.draft.hash !== record.selectedApproval,
    ),
    withdrawn: record.withdrawn,
  }));
}
export async function saveState(root: string, state: EditorialState) {
  await atomicJson(join(root, 'state.json'), state);
}
export async function loadState(root: string): Promise<EditorialState> {
  const state = (await readJson(join(root, 'state.json'))) as EditorialState;
  if (
    state?.schemaVersion !== 1 ||
    !state.records ||
    !Array.isArray(state.audit) ||
    !['synthetic-local-only', 'approved-public'].includes(state.mode)
  )
    throw new ContentError('INVALID_EDITORIAL_STATE');
  return state;
}
export function splitProject(project: PublicProject): {
  profile: PublicProfile;
  organiser: OrganiserFields;
} {
  const {
    id,
    slug,
    theme,
    duration,
    room,
    schedule,
    relatedIds,
    approvedRevision: _,
    ...profile
  } = project;
  return {
    profile,
    organiser: { id, slug, theme, duration, room, schedule, relatedIds },
  };
}
