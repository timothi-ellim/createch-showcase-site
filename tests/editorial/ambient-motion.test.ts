import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const source = stripTypeScriptTypes(
  readFileSync(
    new URL('../../src/scripts/ambient-motion.ts', import.meta.url),
    'utf8',
  ),
);
function mount(
  options: { reduced?: boolean; saved?: string; storageFails?: boolean } = {},
) {
  const control = Object.assign(new EventTarget(), {
    hidden: true,
    disabled: false,
    textContent: '',
  });
  const preference = Object.assign(new EventTarget(), {
    matches: options.reduced ?? false,
  });
  const root = { dataset: { motionLevel: 'full', loopMotion: '' } };
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    hidden: false,
    querySelector: () => control,
    querySelectorAll: () => [],
  });
  const window = Object.assign(new EventTarget(), {
    matchMedia: () => preference,
  });
  let saved = options.saved;
  const localStorage = {
    getItem: () => {
      if (options.storageFails) throw new Error('denied');
      return saved;
    },
    setItem: (_key: string, value: string) => {
      if (options.storageFails) throw new Error('denied');
      saved = value;
    },
  };
  runInNewContext(source, { window, document, localStorage });
  return { control, preference, root, document, window, saved: () => saved };
}

test('pause survives reload and remains effective after visibility changes', () => {
  const page = mount();
  assert.equal(page.root.dataset.loopMotion, 'running');
  assert.equal(page.control.hidden, false);
  page.control.dispatchEvent(new Event('click'));
  assert.equal(page.control.textContent, 'Resume animations');
  assert.equal(page.root.dataset.loopMotion, 'paused');
  page.document.hidden = true;
  page.document.dispatchEvent(new Event('visibilitychange'));
  page.document.hidden = false;
  page.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.root.dataset.loopMotion, 'paused');
  assert.equal(
    mount({ saved: page.saved() }).root.dataset.loopMotion,
    'paused',
  );
  page.control.dispatchEvent(new Event('click'));
  assert.equal(page.root.dataset.loopMotion, 'running');
});

test('OS reduced motion overrides saved preferences, including runtime changes', () => {
  const page = mount({ reduced: true, saved: 'false' });
  assert.equal(page.root.dataset.loopMotion, 'paused');
  assert.equal(page.control.disabled, true);
  page.preference.matches = false;
  page.preference.dispatchEvent(new Event('change'));
  assert.equal(page.root.dataset.loopMotion, 'running');
  assert.equal(page.control.disabled, false);
  page.preference.matches = true;
  page.preference.dispatchEvent(new Event('change'));
  assert.equal(page.root.dataset.loopMotion, 'paused');
});

test('denied storage still permits pause and resume without false persistence claims', () => {
  const page = mount({ storageFails: true });
  page.control.dispatchEvent(new Event('click'));
  assert.equal(page.root.dataset.loopMotion, 'paused');
  page.control.dispatchEvent(new Event('click'));
  assert.equal(page.root.dataset.loopMotion, 'running');
  page.document.hidden = true;
  page.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.root.dataset.loopMotion, 'paused');
});
