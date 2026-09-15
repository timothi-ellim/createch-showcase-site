import { canMove, track } from '../lib/motion/preferences';
import { motionDuration, motionEase } from '../lib/motion/tokens';

const menu = document.querySelector<HTMLDialogElement>('#mobile-menu');
const trigger = document.querySelector<HTMLButtonElement>('[data-menu-open]');
if (menu && trigger && typeof menu.showModal === 'function') {
  document.documentElement.classList.add('nav-enhanced');
  trigger.hidden = false;
  let closing: Animation | null = null;
  let untrack: (() => void) | undefined;
  const close = () => {
    untrack?.();
    untrack = undefined;
    closing?.cancel();
    closing = null;
    menu.removeAttribute('data-closing');
    if (menu.open) menu.close();
  };
  const dismiss = () => {
    if (!menu.open || closing) return;
    if (!canMove() || typeof menu.animate !== 'function') {
      close();
      return;
    }
    const current = getComputedStyle(menu);
    const from = { opacity: current.opacity, transform: current.transform };
    menu.getAnimations().forEach((animation) => animation.cancel());
    menu.dataset.closing = 'true';
    closing = menu.animate(
      [from, { opacity: 0, transform: 'translateY(-8px)' }],
      {
        duration: motionDuration.micro,
        easing: `cubic-bezier(${motionEase.direct.join(',')})`,
      },
    );
    untrack = track(close);
    closing.finished.then(close, () => {});
  };
  trigger.addEventListener('click', () => {
    menu.showModal();
    document.documentElement.classList.add('menu-open');
    trigger.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLButtonElement>('[data-menu-close]')?.focus();
  });
  menu.querySelector('[data-menu-close]')?.addEventListener('click', dismiss);
  menu.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  menu.addEventListener('click', (event) => {
    if (event.target !== menu) return;
    const bounds = menu.getBoundingClientRect();
    if (
      event.clientY > bounds.bottom ||
      event.clientY < bounds.top ||
      event.clientX < bounds.left ||
      event.clientX > bounds.right
    )
      dismiss();
  });
  menu
    .querySelectorAll('a')
    .forEach((link) => link.addEventListener('click', close));
  menu.addEventListener('close', () => {
    document.documentElement.classList.remove('menu-open');
    trigger.setAttribute('aria-expanded', 'false');
    // Resizing into desktop must not leave focus on the now-hidden trigger.
    if (trigger.getClientRects().length) trigger.focus();
    else
      document
        .querySelector<HTMLAnchorElement>('.public-header .brand')
        ?.focus();
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [
      ...menu.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)'),
    ];
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  matchMedia('(min-width: 1024px)').addEventListener(
    'change',
    ({ matches }) => {
      if (matches && menu.open) close();
    },
  );
  window.addEventListener('pagehide', () => {
    if (menu.open) close();
  });
}
// Native details remain usable without JS; expose the same state explicitly.
document.querySelectorAll('details').forEach((details) => {
  const update = () =>
    details
      .querySelector('summary')
      ?.setAttribute('aria-expanded', String(details.open));
  update();
  details.addEventListener('toggle', update);
});
if (location.hash.startsWith('#thread-')) {
  document
    .getElementById(location.hash.slice(1))
    ?.focus({ preventScroll: true });
}
