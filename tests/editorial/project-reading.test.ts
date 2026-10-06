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
  assert.ok(html.indexOf('At a glance') < html.indexOf('What you’ll do'));
});

test('private preview keeps public gallery, save and share actions unavailable', () => {
  const html = renderProjectBody(fixture, { privatePreview: true });
  assert.ok(html.includes('Private preview. This version is not live.'));
  assert.ok(!html.includes('data-open-artwork'));
  assert.ok(!html.includes('data-save='));
  assert.ok(!html.includes('data-copy-link'));
});

test('reviewed third-party media keeps escaped participant credit and linked licence', () => {
  const project = {
    ...fixture,
    media: {
      src: '/media/e6ac1c2da21c6675c58a92f1144a6ca236067a9c827528668432a4de11402a5f.webp',
      alt: 'Coloured nodes connected by lines.',
      credit: 'Supplied credit <script>unsafe</script>',
    },
  };
  const html = renderProjectBody(project);
  assert.ok(html.includes('Supplied credit &lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(html.includes('href="https://creativecommons.org/licenses/by/2.0/"'));
  assert.ok(html.includes('Social Network II — Manel Torralba'));
  assert.ok(!renderProjectBody({ ...project, media: { ...project.media, src: '/media/' + 'a'.repeat(64) + '.webp' } }).includes('CC BY 2.0'));
});
