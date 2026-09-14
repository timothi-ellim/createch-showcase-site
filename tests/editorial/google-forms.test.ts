import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchFormResponses,
  normaliseResponse,
} from '../../editorial/google-forms.ts';
import type { FormConfig } from '../../editorial/google-forms.ts';
const keys = [
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
];
const config = {
  schemaVersion: 1,
  formId: 'synthetic-form',
  questionIds: Object.fromEntries(
    keys.map((key, index) => [key, `question-${index}`]),
  ),
  maxPages: 2,
  mediaChoices: {},
} as FormConfig;
const response = {
  responseId: 'synthetic-response',
  lastSubmittedTime: '2026-09-13T01:00:00Z',
  answers: {
    'question-0': { textAnswers: { answers: [{ value: 'Synthetic title' }] } },
    'question-5': {
      textAnswers: {
        answers: [{ value: 'Look / listen' }, { value: 'Participate' }],
      },
    },
  },
};
test('REST adapter uses stable question IDs and excludes unrelated private fields', () => {
  const input = {
    ...response,
    respondentEmail: 'private@example.invalid',
    other: 'private',
  };
  const normalized = normaliseResponse(config, input, '2026-09-13T02:00:00Z');
  assert.equal(
    (normalized.profile as { title: string }).title,
    'Synthetic title',
  );
  assert.deepEqual(
    (normalized.profile as { encounters: string[] }).encounters,
    ['Look / listen', 'Participate'],
  );
  assert.equal(
    JSON.stringify(normalized).includes('private@example.invalid'),
    false,
  );
});
test('paginated reconciliation is bounded and uses authorization headers, not query secrets', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: URL, options: RequestInit) => {
    calls.push(String(url));
    assert.equal(
      (options.headers as Record<string, string>).Authorization,
      'Bearer synthetic-test-token',
    );
    return Response.json(
      calls.length === 1
        ? { responses: [response], nextPageToken: 'next-page' }
        : { responses: [{ ...response, responseId: 'second-response' }] },
    );
  }) as typeof fetch;
  assert.equal(
    (await fetchFormResponses(config, 'synthetic-test-token', fetcher)).length,
    2,
  );
  assert.ok(calls[1].includes('pageToken=next-page'));
  assert.equal(calls.join('').includes('synthetic-test-token'), false);
});
test('failed or incomplete reconciliation throws without returning partial data or secret errors', async () => {
  await assert.rejects(
    fetchFormResponses(
      config,
      'synthetic-test-token',
      (async () =>
        new Response('secret body', { status: 403 })) as typeof fetch,
    ),
    (error) =>
      (error as Error).message.includes('HTTP 403') &&
      !(error as Error).message.includes('secret body'),
  );
  await assert.rejects(
    fetchFormResponses(
      { ...config, maxPages: 1 },
      'synthetic-test-token',
      (async () =>
        Response.json({
          responses: [response],
          nextPageToken: 'more',
        })) as typeof fetch,
    ),
    /GOOGLE_RECONCILIATION_LIMIT/,
  );
  await assert.rejects(
    fetchFormResponses(config, '', (async () =>
      Response.json({})) as typeof fetch),
    /GOOGLE_ACCESS_TOKEN_REQUIRED/,
  );
});
test('transient provider errors retry within a fixed bound', async () => {
  let calls = 0;
  const result = await fetchFormResponses(
    config,
    'synthetic-test-token',
    (async () =>
      ++calls < 3
        ? new Response('', { status: 503 })
        : Response.json({ responses: [] })) as typeof fetch,
  );
  assert.equal(calls, 3);
  assert.deepEqual(result, []);
});
