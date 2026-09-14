import type { PublicProject } from './content-schema.ts';
export interface ParticipantFields {
  title?: string;
  maker?: string;
  invitation?: string;
  description?: string;
  visitorAction?: string;
  encounters?: ('Look / listen' | 'Participate')[];
  assetId?: string | null;
  alt?: string;
  credit?: string;
  links?: { label: string; url: string }[];
  videoUrl?: string | null;
  processNote?: string;
  accessProposal?: string;
  permission?: boolean;
  termsVersion?: string;
}
export interface PortalDraft {
  projectId: string;
  publicId: string;
  slug: string;
  version: number;
  fields: ParticipantFields;
  metadata: Record<string, unknown>;
  metadataVersion: number;
  updatedAt: string;
}
export interface RevisionPreview extends Omit<PortalDraft, 'version'> {
  revisionId: string;
  prepared: PublicProject | null;
  digest: string | null;
  decisionVersion: number;
  decision: string | null;
  feedback: string | null;
  jobId: string;
  jobStatus: string;
  errorCode: string | null;
  sourceCommit: string | null;
  previous: PublicProject | null;
  media: { path: string; src: string; sha256: string }[] | null;
}
export interface ProjectSummary {
  id: string;
  publicId: string;
  slug: string;
  title: string;
  draftVersion: number;
  latestRevision: string | null;
  status: string;
  feedback: string;
  liveRevision: string | null;
  withdrawn: boolean;
}
export interface PortalContext {
  organiser: boolean;
  owner: boolean;
  editingOpen: boolean;
  environment: string;
  sources: string[];
}
export function draftView(draft: PortalDraft): PublicProject {
  const f = draft.fields,
    m = draft.metadata;
  return {
    id: draft.publicId,
    slug: draft.slug,
    title: f.title || 'Untitled project',
    maker: f.maker || 'Public name pending',
    invitation: f.invitation || '',
    description: f.description || '',
    visitorAction: f.visitorAction || '',
    encounters: f.encounters || [],
    media: null,
    accessNotes: typeof m.accessNotes === 'string' ? m.accessNotes : null,
    duration: typeof m.duration === 'string' ? m.duration : null,
    room: typeof m.room === 'string' ? m.room : null,
    schedule: typeof m.schedule === 'string' ? m.schedule : null,
    theme: m.theme as PublicProject['theme'],
    relatedIds: [],
    links: f.links || [],
    processNote: f.processNote || null,
    processMedia: [],
    videoUrl: f.videoUrl || null,
    approvedRevision: null,
  };
}
export function checkPortalEnvironment(
  url: string,
  environment: string,
  appOrigin: string,
): void {
  const u = new URL(url),
    app = new URL(appOrigin);
  const local = (h: string) => h === '127.0.0.1' || h === 'localhost';
  if (
    !['local', 'staging', 'production'].includes(environment) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/'
  )
    throw new Error('PORTAL_CONFIGURATION_INVALID');
  if (
    environment === 'local'
      ? !local(u.hostname) || !local(app.hostname)
      : u.protocol !== 'https:' ||
        !u.hostname.endsWith('.supabase.co') ||
        app.protocol !== 'https:' ||
        local(app.hostname)
  )
    throw new Error('PORTAL_ENVIRONMENT_MISMATCH');
}
