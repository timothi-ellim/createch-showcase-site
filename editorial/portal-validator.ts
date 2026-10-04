import { z } from 'zod';
import { scheduleIdentity, validateWindows } from '../src/lib/presence.ts';
import {
  profileSchema,
  projectSchema,
  validate,
  digest,
  ContentError,
  freezeSnapshot,
} from '../src/lib/content-schema.ts';
import type {
  PublicProject,
  PublicSnapshot,
} from '../src/lib/content-schema.ts';
import { processImage } from './media.ts';
const text = (max: number) => z.string().trim().max(max);
export const participantSchema = z
  .object({
    title: text(120).min(1),
    maker: text(100).min(1),
    invitation: text(200).min(1),
    description: text(2000).min(1),
    visitorAction: text(700).min(1),
    encounters: profileSchema.shape.encounters.min(1),
    assetId: z.uuid().nullable().optional(),
    alt: text(300).default(''),
    credit: text(200).default(''),
    links: profileSchema.shape.links.max(3).default([]),
    videoUrl: profileSchema.shape.videoUrl,
    processNote: text(800).default(''),
    accessProposal: text(700).default(''),
    permission: z.literal(true),
    termsVersion: z.literal('public-profile-v1'),
  })
  .strict();
// This mode is selected only by server-side organiser authority evidence.
const organiserTextSchema = participantSchema.extend({
  invitation: text(200),
  visitorAction: text(700),
  encounters: profileSchema.shape.encounters,
  permission: z.literal(false),
  termsVersion: z.literal('organiser-text-v1'),
  assetId: z.null(),
  alt: z.literal(''),
  credit: z.literal(''),
  links: z.array(z.never()).max(0),
  videoUrl: z.null(),
  accessProposal: z.literal(''),
});
export async function preparePortalRevision(
  subject: {
    revisionId: string;
    publicId: string;
    slug: string;
    fields: unknown;
    authorisation?: string;
    metadata: Record<string, unknown>;
    asset: { id: string; path: string; bytes: number; type: string } | null;
  },
  download: (path: string) => Promise<Buffer>,
) {
  const organiserText = subject.authorisation === 'organiser-text-v1';
  const f = organiserText
      ? validate(organiserTextSchema, subject.fields)
      : validate(participantSchema, subject.fields),
    m = subject.metadata;
  let media: PublicProject['media'] = null;
  const derived: {
    path: string;
    src: string;
    sha256: string;
    sourceHash: string;
    bytes: Buffer;
  }[] = [];
  if (f.assetId) {
    if (
      !subject.asset ||
      subject.asset.id !== f.assetId ||
      !/^[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(subject.asset.path) ||
      !f.alt ||
      !f.credit
    )
      throw new ContentError('ASSET_BINDING_INVALID');
    const original = await download(subject.asset.path);
    if (original.length !== subject.asset.bytes)
      throw new ContentError('MEDIA_SIZE_MISMATCH');
    const processed = await processImage(original);
    const src = `/media/${processed.sha256}.webp`;
    media = { src, alt: f.alt, credit: f.credit };
    derived.push({
      ...processed,
      src,
      path: `${subject.revisionId}/${processed.sha256}.webp`,
    });
  }
  const snapshot = validate(projectSchema, {
    id: subject.publicId,
    slug: subject.slug,
    title: f.title,
    maker: f.maker,
    invitation: f.invitation,
    description: f.description,
    visitorAction: f.visitorAction,
    encounters: f.encounters,
    media,
    links: f.links,
    videoUrl: f.videoUrl,
    processNote: f.processNote || null,
    processMedia: [],
    theme: m.theme,
    room: m.room ?? null,
    duration: m.duration ?? null,
    schedule: m.schedule ?? null,
    accessNotes: m.accessNotes ?? null,
    relatedIds: m.relatedIds ?? [],
    ...(organiserText ? { publicationBasis: 'organiser-text' } : {}),
    approvedRevision: null,
  });
  return { snapshot, digest: digest(snapshot), derived };
}
export interface PortalManifest {
  schemaVersion: 1 | 2;
  signageVersion?: 1;
  releaseId: string;
  sourceCommit: string;
  environment: 'local' | 'staging' | 'production';
  targetOrigin: string | null;
  targetId: string | null;
  policyVersion: number;
  eventVersion: number;
  event: PublicSnapshot['event'];
  themes: PublicSnapshot['themes'];
  excludedProjects: string[];
  excludedAssets: string[];
  projects: {
    projectId: string;
    revisionId: string;
    digest: string;
    decisionId: number;
    snapshot: PublicProject;
    presence?: {
      decisionId: number;
      revisionId: string;
      digest: string;
      scheduleKey: string;
      windows: { start: string; end: string }[];
    } | null;
    media: { src: string; path: string; sha256: string }[];
  }[];
}
export function snapshotFromManifest(manifest: PortalManifest): PublicSnapshot {
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit))
    throw new ContentError('SOURCE_COMMIT_REQUIRED');
  const projects = manifest.projects.map((item) => {
    const project = validate(projectSchema, item.snapshot);
    if (
      digest(project) !== item.digest ||
      project.invigilationWindows !== undefined ||
      project.approvedRevision !== null ||
      manifest.excludedProjects.includes(project.id)
    )
      throw new ContentError('INELIGIBLE_MANIFEST_PROJECT');
    const media = project.media;
    if (
      media &&
      !item.media.some(
        (m) => m.src === media.src && media.src === `/media/${m.sha256}.webp`,
      )
    )
      throw new ContentError('MEDIA_MANIFEST_MISMATCH');
    if (item.presence) {
      if (
        manifest.schemaVersion !== 2 ||
        item.presence.scheduleKey !== scheduleIdentity(manifest.event) ||
        !/^[a-f0-9]{64}$/.test(item.presence.digest) ||
        !Number.isSafeInteger(item.presence.decisionId) ||
        item.presence.decisionId < 1
      )
        throw new ContentError('INVALID_PRESENCE_BINDING');
      try {
        validateWindows(manifest.event, item.presence.windows);
      } catch {
        throw new ContentError('INVALID_PRESENCE_BINDING');
      }
    }
    return {
      ...project,
      approvedRevision: item.digest,
      ...(item.presence?.windows.length
        ? { invigilationWindows: item.presence.windows }
        : {}),
    };
  });
  const ids = new Set(projects.map((p) => p.id));
  return freezeSnapshot({
    schemaVersion: manifest.schemaVersion,
    publicationStatus:
      manifest.environment === 'local'
        ? 'synthetic-local-only'
        : 'approved-public',
    event: manifest.event,
    themes: manifest.themes,
    projects: projects.map((p) => ({
      ...p,
      relatedIds: p.relatedIds.filter((id) => ids.has(id)),
    })),
  });
}
