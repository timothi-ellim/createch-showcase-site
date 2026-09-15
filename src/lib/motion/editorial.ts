import { animate } from 'motion/mini';
import { inView } from 'motion';
import { canMove, track, settle } from './preferences';
import {
  motionDuration as d,
  motionDistance as distance,
  motionEase,
  heroTiming as h,
} from './tokens';
function reveal(
  element: Element,
  delay = 0,
  duration: number = d.reveal,
  offset: number = distance.small,
  code = false,
) {
  if (
    !canMove() ||
    !(element instanceof HTMLElement) ||
    !element.getClientRects().length
  )
    return;
  const controls = animate(
    element,
    {
      // Keep all meaningful text at full contrast, including during motion.
      opacity: element.matches('.poster-margin, .code-pixel, img')
        ? [0.75, 1]
        : [1, 1],
      transform: code
        ? [
            `translateX(-${distance.small}px) scaleX(.94)`,
            `translateX(${distance.register}px) scaleX(1)`,
            'none',
          ]
        : [`translateY(${offset}px)`, 'none'],
    },
    {
      duration: duration / 1000,
      delay: delay / 1000,
      ease: [...motionEase.editorial],
    },
  );
  const clear = () => {
    controls.cancel();
    untrack();
  };
  const untrack = track(clear);
  controls.finished.then(clear, clear);
}
export function startEditorial() {
  if (!canMove()) return;
  const hero = document.querySelector('.hero');
  if (hero) {
    const mark = hero.querySelector<HTMLElement>('.poster-star');
    if (mark && mark.getClientRects().length && canMove()) {
      const motion = mark.animate(
        [
          { transform: 'rotate(-18deg) scale(.9)' },
          { transform: 'rotate(0deg) scale(1)' },
        ],
        {
          duration: d.editorial,
          easing: `cubic-bezier(${motionEase.editorial.join(',')})`,
        },
      );
      const clear = () => {
        motion.cancel();
        untrack();
      };
      const untrack = track(clear);
      motion.finished.then(clear, () => {});
    }
    for (const [selector, delay, duration] of [
      ['.poster-margin', 0, 250],
      ['.hero-copy > .eyebrow', h.label, 180],
      ['.title-word:nth-child(1)', h.where, 200],
      ['.title-word:nth-child(2)', h.code, 360],
      ['.title-word:nth-child(3)', h.becomes, 200],
      ['.title-word:nth-child(4)', h.culture, 220],
      ['.event-facts', h.facts, 180],
      ['.hero-intro', h.intro, 140],
      ['.actions', h.actions, h.complete - h.actions],
    ] as const) {
      const element = hero.querySelector(selector);
      if (element)
        reveal(
          element,
          delay,
          duration,
          selector.startsWith('.title-word') || selector === '.poster-margin'
            ? distance.reveal
            : distance.register,
          selector.includes('nth-child(2)'),
        );
    }
    hero
      .querySelectorAll('.code-pixel')
      .forEach((pixel, index) =>
        reveal(pixel, h.code + index * 35, 250, distance.small),
      );
  }
  const elements = document.querySelectorAll(
    '[data-motion-reveal], .section-heading, .project-figure:first-child, .detail-grid h1',
  );
  const stop = inView(
    elements,
    (element) => {
      if (element instanceof HTMLElement) element.dataset.motionSeen = 'true';
      reveal(element);
      // No leave callback: Motion observes each element once.
    },
    { amount: 0.15 },
  );
  window.addEventListener('pagehide', stop, { once: true });
  document.addEventListener('createch:filters-changed', ((
    event: CustomEvent,
  ) => {
    settle();
    if (!event.detail.animate || !canMove()) return;
    const cards = document.querySelectorAll(
      '#project-results [data-project-card]:not([hidden])',
    );
    cards.forEach((card, index) =>
      reveal(card, Math.min(index, 2) * 35, d.micro, distance.register),
    );
    const count = document.querySelector('#result-count');
    if (count) reveal(count, 0, d.micro, 0);
  }) as EventListener);
}
