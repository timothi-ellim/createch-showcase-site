import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDraftForm, formFields } from '../../editorial/form-setup.ts';
import { readJson } from '../../editorial/store.ts';

test('form provisioning creates a separate closed form and verifies stable IDs without invitations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'createch-form-test-'));
  const calls: { path: string; method: string }[] = [];
  let items: unknown[] = [];
  const fetcher = async (input: any, options: any) => {
    const path = String(input);
    calls.push({ path, method: options.method });
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(options.redirect, 'error');
    if (path.endsWith('forms?unpublished=true'))
      return Response.json({ formId: 'synthetic-created-form' });
    if (path.endsWith(':setPublishSettings')) {
      assert.deepEqual(JSON.parse(options.body).publishSettings.publishState, {
        isPublished: false,
        isAcceptingResponses: false,
      });
      return Response.json({});
    }
    if (path.endsWith(':batchUpdate')) {
      items = JSON.parse(options.body)
        .requests.filter((r: any) => r.createItem)
        .map((r: any) => r.createItem.item);
      return Response.json({});
    }
    return Response.json({
      items,
      publishSettings: {
        publishState: { isPublished: false, isAcceptingResponses: false },
      },
    });
  };
  const result = await createDraftForm(
    root,
    'synthetic-token',
    fetcher as typeof fetch,
  );
  assert.equal(result.outcome, 'separate-unpublished-form-configured');
  assert.equal(items.length, formFields.length);
  const config = (await readJson(
    join(root, 'form-config.private.json'),
  )) as any;
  assert.equal(
    new Set(Object.values(config.questionIds)).size,
    formFields.length,
  );
  assert.equal(
    calls.some((c) => /permissions|publish=true|send|responses/.test(c.path)),
    false,
  );
  const count = calls.length;
  assert.equal(
    (await createDraftForm(root, 'synthetic-token', fetcher as typeof fetch))
      .outcome,
    'form-already-configured; unchanged',
  );
  assert.equal(calls.length, count);
});
test('an uncertain create never silently creates a second form on retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'createch-form-test-'));
  let requests = 0;
  const fetcher = async () => {
    requests++;
    throw new Error('Secret response body must not escape');
  };
  await assert.rejects(
    createDraftForm(root, 'synthetic-token', fetcher),
    /FORM_SETUP_REQUEST_UNCERTAIN/,
  );
  await assert.rejects(
    createDraftForm(root, 'synthetic-token', fetcher),
    /FORM_CREATION_UNCERTAIN/,
  );
  assert.equal(requests, 1);
});
