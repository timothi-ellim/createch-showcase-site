import { canMove, track } from './preferences';
import '../../styles/physical.css';

// One bounded, event-driven response shared by public pages. This never owns
// application state or delays activation. Existing feedback owns save success.
const selector = [
  '.button',
  '.save-button',
  '.filter-options button',
  '[data-locate-project]',
  '[data-explore-mode]',
  '.site-header nav a',
  '.footer-links a',
  '.shortlist-toolbar button',
  '.filter-drawer summary',
  '.sketch-controls button',
  '[data-home-surprise]',
  "body[data-page='home'] .hero-news",
  "body[data-page='home'] .window-artwork",
  "body[data-page='home'] .window-glimpses a",
  "body[data-page='home'] .welcome-paths a",
  "body[data-page='home'] .theme-tile",
  "body[data-page='home'] .news-links a",
  "body[data-page='home'] .participant-roster a",
  "body[data-page='home'] .text-link",
].join(',');
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const enabled = () =>
  canMove() &&
  document.documentElement.dataset.motionLevel === 'full' &&
  !document.querySelector('dialog[open]');
const field = document.createElement('div');
field.className = 'physical-field';
field.setAttribute('aria-hidden', 'true');
document.body.prepend(field);

document.body.dataset.physicalReady = '';

const effects = new Map<Element, () => void>();
let hovered: HTMLElement | null = null;
let pressed: HTMLElement | null = null;
let frame = 0;
let point = { x: 0, y: 0 };

export function effect(
  target: Element,
  frames: Keyframe[],
  kind: string,
  duration = 520,
  delay = 0,
  remove = false,
) {
  effects.get(target)?.();
  if (!enabled() || !target.getClientRects().length) {
    if (remove) target.remove();
    return;
  }
  const animation = target.animate(frames, {
    duration,
    delay,
    easing: 'cubic-bezier(.2,.75,.25,1)',
  });
  animation.id = `physical-${kind}`;
  const clear = () => {
    animation.cancel();
    effects.delete(target);
    untrack();
    if (remove) target.remove();
  };
  const untrack = track(clear);
  effects.set(target, clear);
  animation.finished.then(clear, () => {});
}

function control(target: EventTarget | null) {
  const element =
    target instanceof Element ? target.closest<HTMLElement>(selector) : null;
  return element &&
    !element.matches(':disabled, [aria-disabled="true"]') &&
    !element.closest('dialog, .analytics-choice, [data-artwork-viewer]')
    ? element
    : null;
}
function clearHover() {
  if (hovered) delete hovered.dataset.physicalHover;
  hovered = null;
  delete field.dataset.active;
}
function release() {
  if (pressed) delete pressed.dataset.physicalDown;
  pressed = null;
}
function reset() {
  clearHover();
  release();
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  for (const cancel of [...effects.values()]) cancel();

}
// Includes reduced-motion, pause, focus, visibility, resize and pagehide.
track(reset);
window.addEventListener('blur', reset);
window.addEventListener('popstate', reset);
document.addEventListener('pointercancel', reset);
document.addEventListener('keydown', clearHover);

function paint() {
  frame = 0;
  if (!enabled()) return;
  field.style.setProperty('--physical-x', `${point.x}px`);
  field.style.setProperty('--physical-y', `${point.y}px`);
  field.style.setProperty('--physical-drift', `${(scrollY * 0.08) % 36}px`);
}
function schedule() {
  if (!frame && enabled()) frame = requestAnimationFrame(paint);
}
function neighbours(
  origin: HTMLElement,
  x: number,
  y: number,
  strength: number,
) {
  // Read all geometry before animating. Only nearby, unfocused controls react;
  // the hovered/pressed target and keyboard focus never move.
  const nearby = [...document.querySelectorAll<HTMLElement>(selector)]
    .filter(
      (el) =>
        el !== origin &&
        !el.contains(origin) &&
        !origin.contains(el) &&
        !el.matches(':disabled, :focus-within, [aria-disabled="true"]') &&
        !el.closest('dialog, .analytics-choice') &&
        el.getClientRects().length,
    )
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .map(({ el, rect }) => ({
      el,
      rect,
      dx: rect.x + rect.width / 2 - x,
      dy: rect.y + rect.height / 2 - y,
    }))
    .map((item) => ({ ...item, distance: Math.hypot(item.dx, item.dy) }))
    .filter(
      (item) =>
        item.distance < 360 &&
        item.rect.bottom > 0 &&
        item.rect.top < innerHeight,
    )
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);
  for (const { el, dx, dy, distance } of nearby) {
    const force = strength * (1 - distance / 420);
    const ax = (dx / Math.max(distance, 1)) * force;
    const ay = (dy / Math.max(distance, 1)) * force;
    effect(
      el,
      [
        { translate: '0px 0px' },
        { translate: `${ax}px ${ay}px`, offset: 0.25 },
        { translate: `${-ax * 0.15}px ${-ay * 0.15}px`, offset: 0.65 },
        { translate: '0px 0px' },
      ],
      'neighbour',
      520,
      distance / 2.8,
    );
  }
}
function impact(origin: HTMLElement, x: number, y: number) {
  if (!enabled()) return;
  // Section backgrounds receive the same document input and render the impulse.
  neighbours(origin, x, y, 12);
  effect(
    origin,
    [
      { filter: 'drop-shadow(0 1px 0 #3d285366)' },
      { filter: 'drop-shadow(0 6px 0 #3d285344)', offset: 0.3 },
      { filter: getComputedStyle(origin).filter },
    ],
    'press',
    380,
  );
  const surfaces = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-project-card], .reading-panel, .theme-tile, .news-links > a, .motion-backdrop',
    ),
  ]
    .filter((el) => el.getClientRects().length && !el.matches(':focus-within'))
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(
      ({ rect }) =>
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        Math.hypot(rect.x + rect.width / 2 - x, rect.y + rect.height / 2 - y) <
          650,
    )
    .slice(0, 4);
  for (const { el } of surfaces) {
    const decoration = el.querySelector('.backdrop-ring');
    if (decoration)
      effect(
        decoration,
        [{ scale: '1' }, { scale: '1.12', offset: 0.3 }, { scale: '1' }],
        'backdrop',
        760,
      );
    else
      effect(
        el,
        [
          { outline: '2px solid #9b82cc00', outlineOffset: '0px' },
          { outline: '2px solid #9b82cc88', outlineOffset: '5px', offset: 0.3 },
          { outline: '2px solid #9b82cc00', outlineOffset: '0px' },
        ],
        'surface',
        700,
        60,
      );
  }
}

document.addEventListener('pointerover', (event) => {
  if (event.pointerType === 'touch' || !fine.matches || !enabled()) return;
  const next = control(event.target);
  if (next === hovered) return;
  clearHover();
  if (!next) return;
  effects.get(next)?.();
  hovered = next;
  next.dataset.physicalHover = '';
  const rect = next.getBoundingClientRect();
  point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  field.dataset.active = '';
  schedule();
  neighbours(next, point.x, point.y, 8);
});
document.addEventListener(
  'pointermove',
  (event) => {
    if (!hovered || event.pointerType === 'touch' || !enabled()) return;
    point = { x: event.clientX, y: event.clientY };
    schedule();
  },
  { passive: true },
);
document.addEventListener('pointerout', (event) => {
  if (!event.relatedTarget) reset();
  else if (
    hovered &&
    event.relatedTarget instanceof Node &&
    !hovered.contains(event.relatedTarget)
  )
    clearHover();
});
document.addEventListener('pointerdown', (event) => {
  release();
  if (event.button !== 0 || !enabled()) return;
  pressed = control(event.target);
  if (pressed) {
    effects.get(pressed)?.();
    pressed.dataset.physicalDown = '';
  }
});
document.addEventListener('pointerup', release);
document.addEventListener('click', (event) => {
  release();
  const target = control(event.target);
  if (
    !target ||
    !enabled() ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey
  )
    return;
  // Selection can change the visible view synchronously (Locate, for example).
  if (!target.getClientRects().length) return;
  const rect = target.getBoundingClientRect();
  const keyboard = event.detail === 0;
  impact(
    target,
    keyboard ? rect.x + rect.width / 2 : event.clientX,
    keyboard ? rect.y + rect.height / 2 : event.clientY,
  );
});
window.addEventListener(
  'scroll',
  () => {
    clearHover();
    release();
    schedule();
  },
  { passive: true },
);

// Decorative heading rules connect the same visual language across reading
// pages. Text is never hidden or translated; rules enter once.
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const rule = entry.target.querySelector('.physical-section-rule');
      if (rule)
        effect(
          rule,
          [
            { transform: 'scaleX(.15)', opacity: 0.3 },
            { transform: 'scaleX(1)', opacity: 1 },
          ],
          'section',
          560,
        );
      observer.unobserve(entry.target);
    }
  },
  { threshold: 0.5 },
);
for (const heading of document.querySelectorAll<HTMLElement>(
  'main h1, main h2',
)) {
  if (heading.closest('.project-card, .atlas, dialog')) continue;
  heading.dataset.physicalHeading = '';
  const rule = document.createElement('span');
  rule.className = 'physical-section-rule';
  rule.setAttribute('aria-hidden', 'true');
  heading.append(rule);
  observer.observe(heading);
}
window.addEventListener('pagehide', () => observer.disconnect(), {
  once: true,
});
