import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript';
import { runInNewContext } from 'node:vm';

const source = transpileModule(
  readFileSync(
    new URL('../../src/lib/motion/preferences.ts', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      target: ScriptTarget.ES2022,
      module: ModuleKind.CommonJS,
    },
  },
).outputText;

function mount(paused = false) {
  const preference = Object.assign(new EventTarget(), { matches: false });
  const root = {
    dataset: { motionLevel: 'full', loopMotion: paused ? 'paused' : 'running' },
  };
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    hidden: false,
  });
  const window = new EventTarget();
  let policyChanged = () => {};
  class MutationObserver {
    constructor(callback: () => void) {
      policyChanged = callback;
    }
    observe() {}
  }
  const api: {
    canMove?: () => boolean;
    track?: (cancel: () => void) => () => void;
  } = {};
  runInNewContext(source, {
    exports: api,
    document,
    window,
    matchMedia: () => preference,
    MutationObserver,
    Event,
  });
  let cancellations = 0;
  const trackAnimation = () => {
    const untrack = api.track!(() => {
      cancellations++;
      untrack();
    });
  };
  return {
    api,
    root,
    preference,
    document,
    window,
    policyChanged: () => policyChanged(),
    trackAnimation,
    cancellations: () => cancellations,
  };
}

test('saved pause blocks entrances; resuming permits them and notifies lazy startup', () => {
  const page = mount(true);
  assert.equal(page.api.canMove!(), false);
  let updates = 0;
  page.document.addEventListener('createch:motion-policy', () => updates++);
  page.root.dataset.loopMotion = 'running';
  page.policyChanged();
  assert.equal(page.api.canMove!(), true);
  assert.equal(updates, 1);
  page.trackAnimation();
  page.root.dataset.loopMotion = 'paused';
  page.policyChanged();
  assert.equal(page.api.canMove!(), false);
  assert.equal(page.cancellations(), 1);
  page.policyChanged();
  assert.equal(page.cancellations(), 1);
});

test('reduced motion and hidden lifecycle cancel pending entrances immediately', () => {
  const page = mount();
  page.trackAnimation();
  page.preference.matches = true;
  page.preference.dispatchEvent(new Event('change'));
  assert.equal(page.api.canMove!(), false);
  assert.equal(page.cancellations(), 1);
  page.preference.matches = false;
  page.trackAnimation();
  page.document.hidden = true;
  page.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.api.canMove!(), false);
  assert.equal(page.cancellations(), 2);
});

test('keyboard focus, resize and page exit settle motion; off disables new work', () => {
  const page = mount();
  for (const [target, name] of [
    [page.document, 'focusin'],
    [page.window, 'resize'],
    [page.window, 'pagehide'],
  ] as const) {
    page.trackAnimation();
    target.dispatchEvent(new Event(name));
  }
  assert.equal(page.cancellations(), 3);
  page.trackAnimation();
  page.root.dataset.motionLevel = 'off';
  page.policyChanged();
  assert.equal(page.api.canMove!(), false);
  assert.equal(page.cancellations(), 4);
});
