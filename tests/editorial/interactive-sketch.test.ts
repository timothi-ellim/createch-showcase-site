import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript';
import { runInNewContext } from 'node:vm';
import { restingPose, sketchPaths } from '../../src/lib/interactive-sketch.ts';

const source = transpileModule(
  readFileSync(
    new URL('../../src/scripts/interactive-sketch.ts', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      target: ScriptTarget.ES2022,
      module: ModuleKind.CommonJS,
    },
  },
).outputText;
class Element extends EventTarget {
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  value = '0';
  hidden = true;
  tabIndex = -1;
  textContent = '';
  captured = new Set<number>();
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  getAttribute(key: string) {
    return this.attributes.get(key);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 600, height: 440 };
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
  focus() {}
}
function emit(target: EventTarget, type: string, props = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), props);
  target.dispatchEvent(event);
  return event;
}
function mount(
  options: { reduced?: boolean; paused?: boolean; fine?: boolean } = {},
) {
  const elements = Object.fromEntries(
    [
      'stage',
      'blend',
      'output',
      'instructions',
      'label',
      'reset',
      'turn',
      'controls',
    ].map((name) => [name, new Element()]),
  ) as Record<
    | 'stage'
    | 'blend'
    | 'output'
    | 'instructions'
    | 'label'
    | 'reset'
    | 'turn'
    | 'controls',
    Element
  >;
  const buttons = [new Element(), new Element(), new Element()];
  const paths = sketchPaths(restingPose).map((d) => {
    const path = new Element();
    path.setAttribute('d', d);
    return path;
  });
  const sketch = {
    querySelector: (selector: string) =>
      elements[selector.slice(13, -1) as keyof typeof elements],
    querySelectorAll: (selector: string) =>
      selector === '[data-sketch-line]' ? paths : buttons,
  };
  const root = new Element();
  root.dataset = {
    loopMotion: options.paused ? 'paused' : 'running',
    motionLevel: 'full',
  };
  const preference = Object.assign(new EventTarget(), {
    matches: options.reduced ?? false,
  });
  const fine = Object.assign(new EventTarget(), {
    matches: options.fine ?? true,
  });
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    hidden: false,
    querySelector: (selector: string) =>
      selector === '[data-sketch]' ? sketch : null,
    querySelectorAll: () => [],
  });
  const window = new EventTarget();
  const frames = new Map<number, () => void>();
  let nextFrame = 0,
    animationCount = 0,
    stoppedAnimations = 0;
  const observers: Array<() => void> = [];
  class MutationObserver {
    constructor(callback: () => void) {
      observers.push(callback);
    }
    observe() {}
  }
  runInNewContext(source, {
    exports: {},
    document,
    window,
    MutationObserver,
    matchMedia: (query: string) =>
      query.includes('reduced') ? preference : fine,
    requestAnimationFrame: (callback: () => void) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    require: (name: string) =>
      name === 'motion'
        ? {
            animate: (
              _from: number,
              to: number,
              config: { onUpdate: (value: number) => void },
            ) => {
              animationCount++;
              config.onUpdate(to);
              return {
                stop: () => {
                  stoppedAnimations++;
                },
              };
            },
          }
        : { restingPose, sketchPaths },
  });
  return {
    ...elements,
    buttons,
    root,
    preference,
    document,
    window,
    frames,
    signature: () => paths.map((path) => path.getAttribute('d')).join('|'),
    flush: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
    sync: () => observers.forEach((callback) => callback()),
    animations: () => animationCount,
    stopped: () => stoppedAnimations,
  };
}
const pointer = (id: number, x: number, y: number, type = 'touch') => ({
  pointerId: id,
  clientX: x,
  clientY: y,
  pointerType: type,
  isPrimary: true,
  button: 0,
});

test('blend and Reset update geometry and accessible state, including while paused', () => {
  const page = mount({ paused: true });
  const initial = page.signature();
  page.blend.value = '25';
  emit(page.blend, 'input');
  assert.notEqual(page.signature(), initial);
  assert.equal(
    page.blend.getAttribute('aria-valuetext'),
    '50% from Orbit to Wave',
  );
  assert.equal(page.output.textContent, 'Orbit / Wave');
  assert.ok(
    page.buttons.every(
      (button) => button.getAttribute('aria-pressed') === 'false',
    ),
  );
  emit(page.buttons[2], 'click');
  assert.equal(page.blend.value, '100');
  assert.equal(page.buttons[2].getAttribute('aria-pressed'), 'true');
  emit(page.reset, 'click');
  assert.equal(page.signature(), initial);
  assert.equal(page.blend.value, '0');
  assert.equal(page.buttons[0].getAttribute('aria-pressed'), 'true');
  assert.equal(page.animations(), 0);
});

test('arrow keys turn without scrolling; Home restores the original drawing', () => {
  const page = mount({ reduced: true });
  const initial = page.signature();
  assert.equal(page.stage.tabIndex, 0);
  assert.equal(
    emit(page.stage, 'keydown', { key: 'ArrowRight' }).defaultPrevented,
    true,
  );
  assert.notEqual(page.signature(), initial);
  assert.equal(
    emit(page.stage, 'keydown', { key: 'Tab' }).defaultPrevented,
    false,
  );
  emit(page.stage, 'keydown', { key: 'Home' });
  assert.equal(page.signature(), initial);
  assert.equal(page.animations(), 0);
});

test('touch drag tracks one pointer, releases capture and retains the chosen view', () => {
  const page = mount({ fine: false });
  const initial = page.signature();
  emit(page.stage, 'pointerdown', pointer(1, 100, 200));
  emit(page.stage, 'pointermove', pointer(2, 500, 200));
  assert.equal(page.frames.size, 0);
  emit(page.stage, 'pointerup', pointer(2, 500, 200));
  assert.equal(page.stage.hasPointerCapture(1), true);
  emit(page.stage, 'pointermove', pointer(1, 260, 200));
  page.flush();
  const turned = page.signature();
  assert.notEqual(turned, initial);
  emit(page.stage, 'pointerup', pointer(1, 260, 200));
  assert.equal(page.stage.hasPointerCapture(1), false);
  assert.equal(page.stage.dataset.dragging, undefined);
  emit(page.stage, 'pointerleave');
  assert.equal(page.signature(), turned);
});

test('a vertical-scroll cancellation restores the previous view and clears pending frames', () => {
  const page = mount({ fine: false });
  const initial = page.signature();
  emit(page.stage, 'pointerdown', pointer(1, 100, 200));
  emit(page.stage, 'pointermove', pointer(1, 115, 280));
  emit(page.stage, 'pointercancel', pointer(1, 115, 280));
  page.flush();
  assert.equal(page.signature(), initial);
  assert.equal(page.frames.size, 0);
  assert.equal(page.stage.hasPointerCapture(1), false);
});

test('pause during dragging cancels work and prevents subsequent pointer motion', () => {
  const page = mount();
  emit(page.stage, 'pointerdown', pointer(1, 100, 200));
  emit(page.stage, 'pointermove', pointer(1, 260, 200));
  page.root.dataset.loopMotion = 'paused';
  page.sync();
  const paused = page.signature();
  page.flush();
  emit(page.stage, 'pointermove', pointer(1, 500, 200));
  assert.equal(page.signature(), paused);
  assert.equal(page.stage.hasPointerCapture(1), false);
  assert.equal(page.frames.size, 0);
  assert.match(page.instructions.textContent, /Motion is paused/);
});

test('hidden lifecycle stops ongoing morphs and drawing remains finite at blend extremes', () => {
  const page = mount();
  emit(page.buttons[2], 'click');
  page.document.hidden = true;
  emit(page.document, 'visibilitychange');
  assert.ok(page.stopped() > 0);
  for (const value of ['0', '25', '50', '75', '100']) {
    page.blend.value = value;
    emit(page.blend, 'input');
    assert.doesNotMatch(page.signature(), /NaN|Infinity/);
  }
});
