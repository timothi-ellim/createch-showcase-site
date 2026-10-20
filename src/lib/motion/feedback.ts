import { canMove, track, settle } from './preferences';
import { motionDuration, motionEase } from './tokens';

const active = new Map<Element, () => void>();
const easing = `cubic-bezier(${motionEase.soft.join(',')})`;

function accent(
  target: Element | null,
  frames: Keyframe[],
  duration: number = motionDuration.editorial,
  cleanup?: () => void,
) {
  if (!target) return;
  active.get(target)?.();
  if (!canMove() || !target.getClientRects().length) {
    cleanup?.();
    return;
  }
  const animation = target.animate(frames, { duration, easing });
  const clear = () => {
    animation.cancel();
    active.delete(target);
    untrack();
    cleanup?.();
  };
  const untrack = track(clear);
  active.set(target, clear);
  animation.finished.then(clear, () => {});
}

export function feedback(target: Element | null) {
  accent(target, [{ opacity: 0.8 }, { opacity: 1 }], motionDuration.micro);
}

// Cancel the previous gesture before starting a new one. Functional refreshes
// (including filtering after a save) must not cancel that gesture's feedback.
document.addEventListener('click', settle, true);
document.addEventListener('input', settle, true);

document.addEventListener('createch:save-feedback', ((event: CustomEvent) => {
  const target = event.detail.target as HTMLElement | null;
  if (!target) return;
  accent(target.querySelector('.save-symbol'), [
    { transform: 'scale(.35) rotate(-35deg)' },
    { transform: 'scale(1.35) rotate(8deg)', offset: 0.45 },
    { transform: 'scale(1) rotate(0)' },
  ]);
  // Preserve light text on dark controls (viewer and project detail).
  const [r, g, b] = getComputedStyle(target)
    .color.match(/[\d.]+/g)!
    .map(Number);
  if (r * 0.2126 + g * 0.7152 + b * 0.0722 > 160) {
    accent(target, [
      { boxShadow: '0 0 0 0 #d4c5ef99' },
      { boxShadow: '0 0 0 7px #d4c5ef44', offset: 0.4 },
      { boxShadow: '0 0 0 0 #d4c5ef00' },
    ]);
    return;
  }
  accent(target, [
    { backgroundColor: '#f7fa87', boxShadow: '0 0 0 0 #5c3b8a66' },
    {
      backgroundColor: '#e8ed72',
      boxShadow: '0 0 0 7px #5c3b8a22',
      offset: 0.4,
    },
    {
      backgroundColor: getComputedStyle(target).backgroundColor,
      boxShadow: '0 0 0 0 #5c3b8a00',
    },
  ]);
}) as EventListener);

document.addEventListener('createch:count-feedback', ((event: CustomEvent) => {
  accent(event.detail.target, [
    { transform: 'scale(1)' },
    { transform: 'scale(1.4)', offset: 0.4 },
    { transform: 'scale(1)' },
  ]);
}) as EventListener);

document.addEventListener('createch:filters-changed', ((event: CustomEvent) => {
  if (!event.detail.animate) return;
  const selected = document.querySelector<HTMLElement>(
    '[data-theme-filter][aria-pressed="true"]',
  );
  const previous = event.detail.previousThemeRect as DOMRect | undefined;
  if (selected && previous && canMove()) {
    const rect = selected.getBoundingClientRect();
    const group = selected.parentElement!;
    const parent = group.getBoundingClientRect();
    const indicator = document.createElement('span');
    indicator.className = 'theme-selection-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    Object.assign(indicator.style, {
      left: `${rect.left - parent.left}px`,
      top: `${rect.top - parent.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    group.append(indicator);
    accent(
      indicator,
      [
        {
          transform: `translate(${previous.left - rect.left}px, ${previous.top - rect.top}px) scale(${previous.width / rect.width}, ${previous.height / rect.height})`,
        },
        { transform: 'none' },
      ],
      motionDuration.editorial,
      () => indicator.remove(),
    );
  }
  // One shared reveal; no per-card stagger or delayed result calculation.
  const results = document.querySelector('#project-results');
  if (!results?.matches(':focus-within'))
    accent(
      results,
      [{ transform: 'translateY(18px)' }, { transform: 'none' }],
      motionDuration.reveal,
    );
  accent(document.querySelector('#result-count'), [
    { backgroundColor: '#f7fa87' },
    { backgroundColor: 'transparent' },
  ]);
}) as EventListener);

document.addEventListener('createch:locate-feedback', () => {
  for (const artwork of document.querySelectorAll(
    '.atlas-pin[aria-current="true"] > .atlas-artwork',
  ))
    accent(
      artwork,
      [
        { transform: 'scale(.8)', boxShadow: '0 0 0 0 #5c3b8a80' },
        {
          transform: 'scale(1.28)',
          boxShadow: '0 0 0 14px #5c3b8a22',
          offset: 0.45,
        },
        { transform: 'scale(1)', boxShadow: '0 0 0 3px #5c3b8a' },
      ],
      640,
    );
  accent(
    document.querySelector('.atlas-selected-project [data-preview-bar]'),
    [
      { backgroundColor: '#d4c5ef', boxShadow: 'inset 6px 0 #5c3b8a' },
      { backgroundColor: '#f7fa87', boxShadow: 'inset 0 0 #5c3b8a' },
    ],
    640,
  );
  accent(
    document.querySelector('.atlas-selected-project .atlas-project-art'),
    [{ transform: 'translateY(20px)' }, { transform: 'none' }],
    640,
  );
});

document.addEventListener('createch:status-feedback', ((event: CustomEvent) => {
  if (event.detail.error) settle();
  else feedback(event.detail.target);
}) as EventListener);
document.addEventListener('createch:preview-feedback', ((event: CustomEvent) =>
  feedback(event.detail.target)) as EventListener);
