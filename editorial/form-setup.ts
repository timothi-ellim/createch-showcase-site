import { join } from 'node:path';
import { ContentError, validate } from '../src/lib/content-schema.ts';
import { atomicJson, readJson } from './store.ts';
import { formConfigSchema } from './google-forms.ts';
import { mediaRegistry } from './media.ts';

// This is an explicit organiser command, never invoked by the visitor application.
// It creates a SEPARATE unpublished form. It does not send or share any links.
export const formFields = [
  ['title', 'Project title', true, false],
  ['maker', 'Public contributor name', true, false],
  ['invitation', 'Invite a visitor in one sentence', true, true],
  ['description', 'About the project', true, true],
  ['visitorAction', 'What will visitors do?', true, true],
  ['encounters', 'How can visitors encounter the work?', true, false],
  ['accessNotes', 'Public access and sensory notes', false, true],
  ['mediaSrc', 'Choose an approved image', false, false],
  ['mediaAlt', 'Describe the image for someone who cannot see it', false, true],
  ['mediaCredit', 'Public image credit', false, false],
  ['linkLabel', 'Your website link label', false, false],
  ['linkUrl', 'Your public website (HTTPS)', false, false],
  ['processNote', 'Behind the work (optional)', false, true],
  ['videoUrl', 'Public video link (optional, HTTPS)', false, false],
] as const;
type SetupJournal = {
  phase: 'creating' | 'created' | 'configured';
  formId?: string;
};
type FormDocument = {
  formId?: string;
  publishSettings?: {
    publishState?: { isPublished?: boolean; isAcceptingResponses?: boolean };
  };
  items?: {
    itemId?: string;
    questionItem?: { question?: { questionId?: string } };
  }[];
};
async function api(
  path: string,
  token: string,
  method: string,
  body: unknown,
  fetcher: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetcher(`https://forms.googleapis.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ContentError('FORM_SETUP_REQUEST_UNCERTAIN', [
      'inspect private setup journal before retry',
    ]);
  }
  if (!response.ok)
    throw new ContentError('FORM_SETUP_FAILED', [`HTTP ${response.status}`]);
  try {
    return await response.json();
  } catch {
    throw new ContentError('FORM_SETUP_RESPONSE_INVALID');
  }
}
export async function createDraftForm(
  root: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  if (!token.trim()) throw new ContentError('GOOGLE_ACCESS_TOKEN_REQUIRED');
  const journalPath = join(root, 'form-setup.private.json');
  let journal: SetupJournal | null = null;
  try {
    journal = (await readJson(journalPath)) as SetupJournal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (journal?.phase === 'creating')
    throw new ContentError('FORM_CREATION_UNCERTAIN', [
      'inspect owner account; do not create a duplicate',
    ]);
  if (journal?.phase === 'configured') {
    validate(
      formConfigSchema,
      await readJson(join(root, 'form-config.private.json')),
    );
    return {
      outcome: 'form-already-configured; unchanged',
      formId: journal.formId,
      next: 'Run the authorised live pilot; this command does not change an existing form.',
    };
  }
  if (!journal) {
    await atomicJson(journalPath, { phase: 'creating' });
    const created = (await api(
      'forms?unpublished=true',
      token,
      'POST',
      { info: { title: 'CreaTech Showcase — public project profile (pilot)' } },
      fetcher,
    )) as FormDocument;
    if (!created.formId || !/^[a-zA-Z0-9_-]+$/.test(created.formId))
      throw new ContentError('FORM_CREATION_UNCERTAIN');
    journal = { phase: 'created', formId: created.formId };
    await atomicJson(journalPath, journal);
  }
  if (!journal.formId || !/^[a-zA-Z0-9_-]+$/.test(journal.formId))
    throw new ContentError('INVALID_FORM_SETUP_JOURNAL');
  const path = `forms/${journal.formId}`;
  await api(
    `${path}:setPublishSettings`,
    token,
    'POST',
    {
      publishSettings: {
        publishState: { isPublished: false, isAcceptingResponses: false },
      },
    },
    fetcher,
  );
  const existing = (await api(
    path,
    token,
    'GET',
    undefined,
    fetcher,
  )) as FormDocument;
  if (existing.items?.length)
    throw new ContentError('FORM_SETUP_PARTIAL_REVIEW_REQUIRED', [
      'inspect existing form and mapping before resuming',
    ]);
  const media = await mediaRegistry(root);
  const mediaChoices = Object.fromEntries(
    media.map((item, index) => [
      `Image ${index + 1} — ${item.credit}`,
      item.src,
    ]),
  );
  const questionIds = Object.fromEntries(
    formFields.map(([key], index) => [key, (0xc200 + index).toString(16)]),
  );
  const expectedItems = formFields.map((_, index) =>
    (0xc100 + index).toString(16),
  );
  if (
    existing.items?.some((item) => !expectedItems.includes(item.itemId ?? ''))
  )
    throw new ContentError('FORM_HAS_UNEXPECTED_ITEMS');
  const missing = formFields.flatMap(
    ([key, title, required, paragraph], index) => {
      const itemId = expectedItems[index];
      if (existing.items?.some((item) => item.itemId === itemId)) return [];
      const choiceQuestion =
        key === 'encounters'
          ? {
              type: 'CHECKBOX',
              options: [{ value: 'Look / listen' }, { value: 'Participate' }],
              shuffle: false,
            }
          : key === 'mediaSrc' && media.length
            ? {
                type: 'DROP_DOWN',
                options: Object.keys(mediaChoices).map((value) => ({ value })),
                shuffle: false,
              }
            : null;
      return [
        {
          createItem: {
            item: {
              itemId,
              title,
              ...(key === 'mediaSrc' && !media.length
                ? {
                    description:
                      'Leave blank until the organiser supplies approved image choices. Arrange image transfer privately with the organiser.',
                  }
                : {}),
              ...(key === 'accessNotes'
                ? {
                    description:
                      'Only describe the visitor experience. Do not include private personal access needs, medical information or contact details.',
                  }
                : {}),
              questionItem: {
                question: {
                  questionId: questionIds[key],
                  required,
                  ...(choiceQuestion
                    ? { choiceQuestion }
                    : { textQuestion: { paragraph } }),
                },
              },
            },
            location: { index },
          },
        },
      ];
    },
  );
  if (missing.length)
    await api(
      `${path}:batchUpdate`,
      token,
      'POST',
      {
        requests: [
          {
            updateFormInfo: {
              info: {
                description:
                  'Public exhibition profile only. Do not enter private logistics or contact details. Submission creates a draft for organiser review; it does not publish a page. Only submit material you have permission to make public. Keep your response-edit link private.',
              },
              updateMask: 'description',
            },
          },
          ...missing,
        ],
      },
      fetcher,
    );
  const verified = (await api(
    path,
    token,
    'GET',
    undefined,
    fetcher,
  )) as FormDocument;
  const publishState = verified.publishSettings?.publishState;
  if (
    publishState?.isPublished !== false ||
    publishState?.isAcceptingResponses !== false
  )
    throw new ContentError('FORM_CLOSED_STATE_NOT_VERIFIED');
  for (const [index, [field]] of formFields.entries()) {
    const item = verified.items?.find(
      (item) => item.itemId === expectedItems[index],
    );
    if (item?.questionItem?.question?.questionId !== questionIds[field])
      throw new ContentError('FORM_QUESTION_MAPPING_NOT_VERIFIED');
  }
  const config = validate(formConfigSchema, {
    schemaVersion: 1,
    formId: journal.formId,
    questionIds,
    mediaChoices,
    maxPages: 5,
  });
  await atomicJson(join(root, 'form-config.private.json'), config);
  await atomicJson(journalPath, { ...journal, phase: 'configured' });
  return {
    outcome: 'separate-unpublished-form-configured',
    next: 'Enable response editing and inspect responder restrictions in Google Forms; run the two-contributor pilot before invitations.',
    formId: journal.formId,
  };
}
