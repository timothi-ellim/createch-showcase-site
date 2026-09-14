import { z } from 'zod';
import { ContentError, validate } from '../src/lib/content-schema.ts';
import type { IntakeResponse } from './workflow.ts';

const fields = [
  'title',
  'maker',
  'invitation',
  'description',
  'visitorAction',
  'encounters',
  'accessNotes',
  'mediaSrc',
  'mediaAlt',
  'mediaCredit',
  'linkLabel',
  'linkUrl',
  'processNote',
  'videoUrl',
] as const;
const questionIdsSchema = z
  .object(
    Object.fromEntries(
      fields.map((field) => [field, z.string().min(1)]),
    ) as Record<(typeof fields)[number], z.ZodString>,
  )
  .strict();
export const formConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    formId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    questionIds: questionIdsSchema,
    maxPages: z.number().int().min(1).max(20).default(5),
    mediaChoices: z
      .record(
        z.string(),
        z.string().regex(/^\/media\/[a-f0-9]{64}\.(?:png|jpg|webp)$/),
      )
      .default({}),
  })
  .strict();
export type FormConfig = z.infer<typeof formConfigSchema>;
type FormResponse = {
  responseId: string;
  lastSubmittedTime: string;
  answers: Record<string, { textAnswers?: { answers: { value: string }[] } }>;
};

export function normaliseResponse(
  config: FormConfig,
  response: FormResponse,
  observedAt: string,
): IntakeResponse {
  if (!response.responseId || !response.lastSubmittedTime || !response.answers)
    throw new ContentError('MALFORMED_FORMS_RESPONSE');
  const values = (field: (typeof fields)[number]) =>
    response.answers[config.questionIds[field]]?.textAnswers?.answers.map(
      (answer) => answer.value,
    ) ?? [];
  const text = (field: (typeof fields)[number]) =>
    values(field)[0]?.trim() ?? '';
  return {
    formId: config.formId,
    responseId: response.responseId,
    observedAt,
    lastSubmittedAt: response.lastSubmittedTime,
    profile: {
      title: text('title'),
      maker: text('maker'),
      invitation: text('invitation'),
      description: text('description'),
      visitorAction: text('visitorAction'),
      encounters: values('encounters'),
      accessNotes: text('accessNotes') || null,
      media: text('mediaSrc')
        ? {
            src: config.mediaChoices[text('mediaSrc')] ?? text('mediaSrc'),
            alt: text('mediaAlt'),
            credit: text('mediaCredit'),
          }
        : null,
      links: text('linkUrl')
        ? [{ label: text('linkLabel'), url: text('linkUrl') }]
        : [],
      processNote: text('processNote') || null,
      processMedia: [],
      videoUrl: text('videoUrl') || null,
    },
  };
}
export async function fetchFormResponses(
  configValue: unknown,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<IntakeResponse[]> {
  const config = validate(formConfigSchema, configValue);
  if (!accessToken.trim())
    throw new ContentError('GOOGLE_ACCESS_TOKEN_REQUIRED');
  if (new Set(Object.values(config.questionIds)).size !== fields.length)
    throw new ContentError('DUPLICATE_QUESTION_MAPPING');
  const observedAt = new Date().toISOString();
  let pageToken = '';
  const tokens = new Set<string>();
  const responses: IntakeResponse[] = [];
  for (let page = 0; page < config.maxPages; page++) {
    const url = new URL(
      `https://forms.googleapis.com/v1/forms/${config.formId}/responses`,
    );
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    let result: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await fetcher(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(20_000),
          redirect: 'error',
        });
      } catch {
        throw new ContentError('GOOGLE_RESPONSE_FETCH_FAILED');
      }
      if (![429, 500, 502, 503, 504].includes(result.status)) break;
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    }
    if (!result?.ok)
      throw new ContentError('GOOGLE_RESPONSE_FETCH_FAILED', [
        `HTTP ${result?.status ?? 'unknown'}`,
      ]);
    let body: { responses?: FormResponse[]; nextPageToken?: string };
    try {
      body = await result.json();
    } catch {
      throw new ContentError('INVALID_GOOGLE_RESPONSE');
    }
    if (body.responses !== undefined && !Array.isArray(body.responses))
      throw new ContentError('INVALID_GOOGLE_RESPONSE');
    responses.push(
      ...(body.responses ?? []).map((response) =>
        normaliseResponse(config, response, observedAt),
      ),
    );
    pageToken = body.nextPageToken ?? '';
    if (!pageToken) return responses;
    if (tokens.has(pageToken)) throw new ContentError('GOOGLE_PAGINATION_LOOP');
    tokens.add(pageToken);
  }
  // Never commit a partially reconciled batch when pagination is incomplete.
  throw new ContentError('GOOGLE_RECONCILIATION_LIMIT', [
    'increase bounded maxPages after review',
  ]);
}
