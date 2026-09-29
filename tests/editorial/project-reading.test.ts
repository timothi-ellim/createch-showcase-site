import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.ts';
import { renderProjectBody } from '../../src/lib/project-renderer.ts';

test('reading layout preserves contributor paragraphs and escapes each one', () => {
  const html = renderProjectBody({
    ...fixture,
    description:
      'First paragraph.\n\nSecond <script>alert(1)</script> paragraph.',
  });
  assert.ok(
    html.includes(
      '<p class="preserve-lines">First paragraph.</p><p class="preserve-lines">Second &lt;script&gt;alert(1)&lt;/script&gt; paragraph.</p>',
    ),
  );
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.indexOf('<h1>') < html.indexOf('<figure'));
  assert.ok(html.indexOf('What you’ll do') < html.indexOf('At a glance'));
});

test('private preview keeps public gallery, save and share actions unavailable', () => {
  const html = renderProjectBody(fixture, { privatePreview: true });
  assert.ok(html.includes('Private preview. This version is not live.'));
  assert.ok(!html.includes('data-open-artwork'));
  assert.ok(!html.includes('data-save='));
  assert.ok(!html.includes('data-copy-link'));
});
