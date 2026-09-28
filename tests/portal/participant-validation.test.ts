import test from 'node:test';
import assert from 'node:assert/strict';
import {
  participantFieldIssues,
  publicTextIssue,
  publicUrlIssue,
  validationFailure,
} from '../../src/lib/participant-validation.ts';
import { profileSchema } from '../../src/lib/content-schema.ts';
import { fields as fixtureFields } from './database-harness.ts';
const fields = { ...fixtureFields, encounters: ['Look / listen' as const] };

test('participant link guidance agrees with publication validation', () => {
  for (const url of [
    'https://example.com/work',
    'https://youtu.be/example',
    'http://example.com',
    'not a url',
    'https://docs.google.com/document/d/test',
    'https://drive.google.com/file/d/test',
    'https://127.0.0.1/x',
    'https://user:password@example.com',
    'https://example.com/?token=private',
    'https://example.com/a b',
    'https://example.com/"quoted"',
  ]) {
    assert.equal(
      publicUrlIssue(url) === null,
      profileSchema.shape.videoUrl.safeParse(url).success,
      url,
    );
  }
});
test('plain-text guidance agrees with publication validation without echoing rejected input', () => {
  for (const text of [
    'A normal description',
    'Art & culture',
    '<b>Art</b>',
    'Control\u0001text',
    'private edit2=secret',
    'Bearer private-value',
  ]) {
    assert.equal(
      publicTextIssue(text) === null,
      profileSchema.shape.title.safeParse(text).success,
    );
    if (publicTextIssue(text)) assert(!publicTextIssue(text)!.includes(text));
  }
});
test('incomplete drafts remain saveable and full submission identifies specific fields', () => {
  assert.deepEqual(
    participantFieldIssues(
      {
        ...fields,
        title: '',
        encounters: [],
        permission: false,
        assetId: 'synthetic',
        links: [{ label: '', url: 'invalid' }],
      },
      false,
    ),
    [],
  );
  const issues = participantFieldIssues({
    ...fields,
    assetId: 'synthetic',
    alt: ' ',
    credit: '',
    links: [
      { label: '', url: '' },
      { label: '', url: 'https://example.com' },
    ],
    videoUrl: 'http://example.com',
  });
  assert.deepEqual(
    issues.map((x) => x.name),
    ['alt', 'credit', 'link-label-1', 'videoUrl'],
  );
  assert.deepEqual(participantFieldIssues(fields), []);
});
test('failed checks distinguish correcting content from retrying infrastructure without raw diagnostics', () => {
  for (const code of [
    'IMAGE_DECODE_FAILED',
    'INVALID_MEDIA_SIZE',
    'MEDIA_SIZE_MISMATCH',
    'ASSET_BINDING_INVALID',
    'VALIDATION_FAILED',
  ]) {
    assert.equal(validationFailure(code).editRequired, true);
    assert.match(validationFailure(code).message, /editing/);
  }
  for (const code of [
    'PRIVATE_MEDIA_UNAVAILABLE',
    'VALIDATION_LEASE_EXPIRED',
    'unknown-private-diagnostic',
    null,
  ]) {
    assert.equal(validationFailure(code).editRequired, false);
    assert.match(validationFailure(code).message, /Retry checks/);
    assert(
      !validationFailure(code).message.includes('unknown-private-diagnostic'),
    );
  }
});
