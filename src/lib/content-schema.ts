import { createHash } from 'node:crypto';
import { z } from 'zod';

// Strict, public-only schemas are shared by editorial export and Astro. Errors name
// fields; they never repeat the rejected input, which may contain private material.
export class ContentError extends Error {
  code: string;
  fields: string[];
  constructor(code: string, fields: string[] = []) {
    super(`${code}${fields.length ? ` (${fields.join(', ')})` : ''}`);
    this.code = code;
    this.fields = fields;
    this.name = 'ContentError';
  }
}
const plain = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (value) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),
      'Plain text required',
    )
    .refine(
      (value) =>
        !/edit2=|editresponse|usp=pp_url|Bearer\s|AIza[A-Za-z0-9_-]{20}/i.test(
          value,
        ),
      'Private link or credential pattern',
    );
export const idSchema = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const httpsUrl = z
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !/[<>"'\s]/.test(value) &&
      !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|.*\.local$)/i.test(
        url.hostname,
      ) &&
      !/(?:^|\.)docs\.google\.com$/.test(url.hostname) &&
      !/(?:^|\.)drive\.google\.com$/.test(url.hostname) &&
      !/[?&](?:token|key|edit2|secret|auth|access_token)=/i.test(value)
    );
  }, 'Public HTTPS URL required');
export const mediaSchema = z
  .object({
    src: z.string().regex(/^\/media\/[a-f0-9]{64}\.(?:png|jpg|webp)$/),
    alt: plain(500),
    credit: plain(300),
  })
  .strict();
export const profileSchema = z
  .object({
    title: plain(220),
    maker: plain(160),
    invitation: plain(350),
    description: plain(6000),
    visitorAction: plain(1600),
    encounters: z
      .array(z.enum(['Look / listen', 'Participate']))
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
    accessNotes: plain(1600).nullable(),
    media: mediaSchema.nullable(),
    links: z
      .array(z.object({ label: plain(100), url: httpsUrl }).strict())
      .max(5),
    processNote: plain(3000).nullable().default(null),
    processMedia: z.array(mediaSchema).max(6).default([]),
    videoUrl: httpsUrl.nullable().default(null),
  })
  .strict();
export const organiserSchema = z
  .object({
    id: idSchema,
    slug: idSchema,
    theme: z.enum(['image', 'world', 'relation']),
    duration: plain(120).nullable(),
    room: plain(120).nullable(),
    schedule: plain(300).nullable(),
    relatedIds: z
      .array(idSchema)
      .max(6)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export const projectSchema = profileSchema
  .extend({
    ...organiserSchema.shape,
    approvedRevision: digestSchema.nullable(),
  })
  .strict();
export type PublicProject = z.infer<typeof projectSchema>;
export type PublicProfile = z.infer<typeof profileSchema>;
export type OrganiserFields = z.infer<typeof organiserSchema>;
export const themeSchema = z
  .object({
    id: z.enum(['image', 'world', 'relation']),
    name: plain(60),
    description: plain(300),
    number: z.string().regex(/^0[1-3]$/),
  })
  .strict();
export const eventSchema = z
  .object({
    title: plain(150),
    series: plain(100),
    date: z.iso.date(),
    dateLabel: plain(80),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    timeZone: z.literal('Europe/London'),
    venue: z
      .object({
        name: plain(100),
        streetAddress: plain(200),
        city: plain(100),
        postalCode: plain(20),
      })
      .strict(),
    primaryAction: plain(100),
    secondaryAction: plain(100),
    activeParticipantDeadline: z.null(),
    visitorRegistrationUrl: httpsUrl.nullable(),
    publicContact: z
      .object({ label: plain(160), email: z.email() })
      .strict()
      .nullable(),
    confirmedVenueAccessInformation: plain(5000).nullable(),
    participantEditingRoute: z.enum([
      'not-configured',
      'private-google-form',
      'supabase-portal',
    ]),
    registrationPolicy: plain(3000).nullable().default(null),
    arrivalInformation: plain(3000).nullable().default(null),
    publicSiteUrl: httpsUrl
      .refine((value) => {
        const url = new URL(value);
        return url.pathname === '/' && !url.search && !url.hash && !url.port;
      }, 'Public site origin required')
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((event, ctx) => {
    const expected = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
      .format(new Date(`${event.date}T12:00:00Z`))
      .replaceAll(',', '');
    if (event.dateLabel !== expected)
      ctx.addIssue({
        code: 'custom',
        path: ['dateLabel'],
        message: 'Date label disagrees with ISO date',
      });
    if (
      event.startTime >= event.endTime ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.startTime) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.endTime)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['startTime'],
        message: 'Invalid event times',
      });
  });
export const snapshotPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    publicationStatus: z.enum(['synthetic-local-only', 'approved-public']),
    event: eventSchema,
    themes: z.array(themeSchema).length(3),
    projects: z.array(projectSchema).max(500),
  })
  .strict()
  .superRefine((data, ctx) => {
    for (const key of ['id', 'slug'] as const) {
      if (
        new Set(data.projects.map((project) => project[key])).size !==
        data.projects.length
      )
        ctx.addIssue({
          code: 'custom',
          path: ['projects'],
          message: `Duplicate ${key}`,
        });
    }
    if (new Set(data.themes.map((theme) => theme.id)).size !== 3)
      ctx.addIssue({
        code: 'custom',
        path: ['themes'],
        message: 'Duplicate theme',
      });
    for (const project of data.projects) {
      if (project.relatedIds.includes(project.id))
        ctx.addIssue({
          code: 'custom',
          path: ['projects', project.id, 'relatedIds'],
          message: 'Self-related project',
        });
      if (
        data.publicationStatus === 'approved-public' &&
        (!project.approvedRevision ||
          /^fixture-|^sample-/.test(project.id) ||
          /synthetic|fictional|fixture/i.test(
            `${project.title} ${project.maker}`,
          ))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['projects', project.id],
          message: 'Unapproved or fixture record in public output',
        });
    }
  });
export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;
export type PublicSnapshot = SnapshotPayload & { revision: string };
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ContentError('VALIDATION_FAILED', [
      ...new Set(
        result.error.issues.map((issue) => issue.path.join('.') || 'record'),
      ),
    ]);
  return result.data;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function freezeSnapshot(payload: unknown): PublicSnapshot {
  const parsed = validate(snapshotPayloadSchema, payload);
  return { ...parsed, revision: digest(parsed) };
}
export function readSnapshot(value: unknown): PublicSnapshot {
  const parsed = validate(
    snapshotPayloadSchema.safeExtend({ revision: digestSchema }),
    value,
  );
  const { revision, ...payload } = parsed;
  if (digest(payload) !== revision)
    throw new ContentError('SNAPSHOT_HASH_MISMATCH');
  return parsed;
}
export function releaseBlockers(snapshot: PublicSnapshot): string[] {
  const blockers: string[] = [];
  if (snapshot.publicationStatus !== 'approved-public')
    blockers.push('synthetic content');
  if (!snapshot.projects.length) blockers.push('approved projects');
  for (const key of [
    'publicContact',
    'registrationPolicy',
    'arrivalInformation',
    'confirmedVenueAccessInformation',
    'publicSiteUrl',
  ] as const)
    if (!snapshot.event[key]) blockers.push(key);
  if (snapshot.projects.some((project) => !project.media))
    blockers.push('approved project media');
  if (snapshot.event.participantEditingRoute !== 'supabase-portal')
    blockers.push('verified participant editing route');
  if (
    snapshot.projects.some(
      (project) => !project.room || !project.schedule || !project.accessNotes,
    )
  )
    blockers.push('confirmed project location, timing and public access notes');
  return blockers;
}
