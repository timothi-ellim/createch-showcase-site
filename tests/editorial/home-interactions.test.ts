import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript';
import { runInNewContext } from 'node:vm';

const source = transpileModule(
  readFileSync(
    new URL('../../src/scripts/home-interactions.ts', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      target: ScriptTarget.ES2022,
      module: ModuleKind.CommonJS,
    },
  },
).outputText;

function mount() {
  class Element extends EventTarget {
    dataset: Record<string, string> = {};
    values = new Map<string, string>();
    style = {
      setProperty: (key: string, value: string) => this.values.set(key, value),
      removeProperty: (key: string) => this.values.delete(key),
    };
    rect = { left: 0, top: 0, width: 600, height: 400 };
    parentElement: Element = this;
    field: Element | null = null;
    surface: Element | null = null;
    focused = false;
    classList = {
      contains: (name: string) => name === 'hero' && this === hero,
    };
    getBoundingClientRect() {
      return this.rect;
    }
    matches() {
      return this.focused;
    }
    closest(selector: string) {
      return selector === '[data-motion-field]'
        ? this.field
        : selector === '[data-motion-surface]'
          ? this.surface
          : this.focused
            ? this
            : null;
    }
  }
  const hero = new Element();
  hero.field = hero;
  const card = new Element();
  card.surface = card;
  const word = new Element();
  word.rect = { left: 30, top: 40, width: 240, height: 90 };
  const rule = new Element();
  const root = { dataset: { motionLevel: 'full', loopMotion: 'running' } };
  let allowed = true;
  let dialog = false;
  const fine = Object.assign(new EventTarget(), { matches: true });
  const reduced = Object.assign(new EventTarget(), { matches: false });
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    querySelector: () => (dialog ? {} : null),
    querySelectorAll: (selector: string) =>
      selector === '[data-motion-field]'
        ? [hero]
        : selector === '.hero .word-ink'
          ? [word]
          : selector.includes('.news-links a')
            ? [card]
            : [rule],
  });
  const window = Object.assign(new EventTarget(), { innerHeight: 800 });
  let intersection: (entries: unknown[]) => void = () => {};
  class IntersectionObserver {
    constructor(callback: typeof intersection) {
      intersection = callback;
    }
    observe() {}
    unobserve() {}
  }
  let nextFrame = 0;
  const frames = new Map<number, () => void>();
  const api: { startHomeInteractions?: () => void } = {};
  runInNewContext(source, {
    exports: api,
    require: () => ({ canMove: () => allowed && !reduced.matches }),
    document,
    window,
    Element,
    IntersectionObserver,
    matchMedia: (query: string) => (query.includes('hover') ? fine : reduced),
    requestAnimationFrame: (callback: () => void) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  api.startHomeInteractions!();
  const flush = () => {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback();
    }
  };
  flush();
  const move = (target = hero, type = 'mouse', x = 200, y = 100) => {
    const event = new Event('pointermove');
    Object.defineProperties(event, {
      target: { value: target },
      pointerType: { value: type },
      clientX: { value: x },
      clientY: { value: y },
    });
    document.dispatchEvent(event);
  };
  return {
    hero,
    card,
    word,
    rule,
    root,
    fine,
    reduced,
    document,
    window,
    frames,
    flush,
    move,
    visible: () =>
      intersection([
        { target: hero, isIntersecting: true },
        { target: rule, isIntersecting: true },
      ]),
    allow: (value: boolean) => {
      allowed = value;
    },
    dialog: (value: boolean) => {
      dialog = value;
    },
  };
}

test('pointer events coalesce into one frame and leave no idle render loop', () => {
  const page = mount();
  page.move();
  page.move(undefined, 'mouse', 240, 130);
  assert.equal(page.frames.size, 1);
  page.flush();
  assert.equal(page.frames.size, 0);
  assert.equal(page.hero.values.get('--light-x'), '240px');
  assert.ok(parseFloat(page.word.values.get('--response-x')!) > 0);
  assert.ok(parseFloat(page.word.values.get('--response-x')!) <= 7);
});

test('touch, coarse pointers, focused cards and open dialogs do not move targets', () => {
  const page = mount();
  page.move(page.hero, 'touch');
  page.flush();
  assert.equal(page.hero.values.size, 0);
  page.fine.matches = false;
  page.move();
  page.flush();
  assert.equal(page.hero.values.size, 0);
  page.fine.matches = true;
  page.card.focused = true;
  page.move(page.card);
  page.flush();
  assert.equal(page.card.values.size, 0);
  page.dialog(true);
  page.move();
  page.flush();
  assert.equal(page.frames.size, 0);
  assert.equal(page.hero.values.size, 0);
});

test('pause cancels a queued frame and clears geometry; resume works without reload', () => {
  const page = mount();
  page.visible();
  page.move();
  page.flush();
  assert.ok(page.hero.values.size > 0);
  page.move();
  page.root.dataset.loopMotion = 'paused';
  page.document.dispatchEvent(new Event('createch:motion-policy'));
  assert.equal(page.frames.size, 0);
  assert.equal(page.hero.values.size, 0);
  assert.equal(page.word.values.size, 0);
  page.root.dataset.loopMotion = 'running';
  page.document.dispatchEvent(new Event('createch:motion-policy'));
  page.move(page.card);
  page.flush();
  assert.ok(page.card.values.has('--response-rx'));
});

test('focus, preference change and page lifecycle immediately clear pointer motion', () => {
  const page = mount();
  for (const [target, event] of [
    [page.document, 'focusin'],
    [page.window, 'resize'],
    [page.window, 'pagehide'],
    [page.document, 'visibilitychange'],
    [page.reduced, 'change'],
  ] as const) {
    page.move();
    page.flush();
    assert.ok(page.word.values.size > 0);
    target.dispatchEvent(new Event(event));
    assert.equal(page.word.values.size, 0);
    assert.equal(page.hero.values.size, 0);
  }
  page.reduced.matches = true;
  page.move();
  page.flush();
  assert.equal(page.hero.values.size, 0);
});

test('scroll clears stale pointer position and only offsets visible decoration', () => {
  const page = mount();
  page.visible();
  page.move();
  page.flush();
  page.window.dispatchEvent(new Event('scroll'));
  page.flush();
  assert.equal(page.word.values.size, 0);
  assert.equal(page.hero.values.has('--light-x'), false);
  assert.ok(
    Math.abs(parseFloat(page.hero.values.get('--scroll-drift')!)) <= 28,
  );
  assert.equal(page.rule.dataset.motionEntered, '');
  assert.equal(page.frames.size, 0);
});
