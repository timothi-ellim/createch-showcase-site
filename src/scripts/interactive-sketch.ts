import { animate } from 'motion';
import { restingPose, sketchPaths } from '../lib/interactive-sketch';

const root = document.documentElement;
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const permitted = () =>
  !preference.matches &&
  !document.hidden &&
  root.dataset.loopMotion === 'running' &&
  !document.querySelector('dialog[open]');
const sketch = document.querySelector<HTMLElement>('[data-sketch]');
const stage = sketch?.querySelector<HTMLElement>('[data-sketch-stage]');
if (sketch && stage) {
  const pose = { ...restingPose };
  const paths = [
    ...sketch.querySelectorAll<SVGPathElement>('[data-sketch-line]'),
  ];
  const buttons = [
    ...sketch.querySelectorAll<HTMLButtonElement>('[data-sketch-shape]'),
  ];
  const instructions = sketch.querySelector<HTMLElement>(
    '[data-sketch-instructions]',
  )!;
  let rotation: ReturnType<typeof animate> | undefined;
  let morph: ReturnType<typeof animate> | undefined;
  let inView = true;
  let selectedShape = 0;
  const draw = () =>
    sketchPaths(pose).forEach((d, i) => paths[i].setAttribute('d', d));
  const stop = () => {
    rotation?.stop();
    morph?.stop();
    rotation = morph = undefined;
    pose.shape = selectedShape;
    draw();
  };
  const rotate = (yaw: number, pitch: number) => {
    rotation?.stop();
    const start = { ...pose };
    if (!permitted() || !inView) {
      pose.yaw = yaw;
      pose.pitch = pitch;
      draw();
      return;
    }
    rotation = animate(0, 1, {
      duration: 0.65,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (t) => {
        pose.yaw = start.yaw + (yaw - start.yaw) * t;
        pose.pitch = start.pitch + (pitch - start.pitch) * t;
        draw();
      },
    });
  };
  buttons.forEach((button, index) =>
    button.addEventListener('click', () => {
      selectedShape = index;
      buttons.forEach((item) =>
        item.setAttribute('aria-pressed', String(item === button)),
      );
      sketch.querySelector('[data-sketch-label]')!.textContent =
        `0${index + 1} — ${button.textContent?.trim()}`;
      morph?.stop();
      if (!permitted() || !inView) {
        pose.shape = index;
        draw();
        return;
      }
      morph = animate(pose.shape, index, {
        duration: 0.9,
        ease: [0.4, 0, 0.2, 1],
        onUpdate: (value) => {
          pose.shape = value;
          draw();
        },
      });
    }),
  );
  sketch
    .querySelector('[data-sketch-turn]')
    ?.addEventListener('click', () =>
      rotate(pose.yaw + Math.PI / 3, pose.pitch),
    );
  stage.addEventListener(
    'pointermove',
    (event) => {
      if (
        !inView ||
        event.pointerType === 'touch' ||
        !finePointer.matches ||
        !permitted()
      )
        return;
      const rect = stage.getBoundingClientRect();
      const x = Math.max(
        -1,
        Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1),
      );
      const y = Math.max(
        -1,
        Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      rotate(restingPose.yaw + x * 1.1, restingPose.pitch + y * 0.7);
    },
    { passive: true },
  );
  stage.addEventListener('pointerleave', () => {
    if (inView && permitted()) rotate(restingPose.yaw, restingPose.pitch);
  });
  const sync = () => {
    if (!permitted()) {
      stop();
      // Explicit shape choices still render fully when animation is interrupted.
      pose.shape = selectedShape;
      draw();
    }
    instructions.textContent = !permitted()
      ? 'Motion is paused. Shape and Turn buttons still show each view without animation.'
      : finePointer.matches
        ? 'Move your pointer across the sculpture. Try a shape, or use Turn to see another angle.'
        : 'Tap a shape, then tap Turn to see the sculpture from another angle.';
  };
  const policyObserver = new MutationObserver(sync);
  policyObserver.observe(root, {
    attributes: true,
    attributeFilter: ['data-loop-motion', 'data-motion-level'],
  });
  const dialogObserver = new MutationObserver(sync);
  document.querySelectorAll('dialog').forEach((dialog) =>
    dialogObserver.observe(dialog, {
      attributes: true,
      attributeFilter: ['open'],
    }),
  );
  preference.addEventListener('change', sync);
  finePointer.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', stop);
  window.addEventListener('resize', stop);
  window.addEventListener('pageshow', sync);
  if ('IntersectionObserver' in window)
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (!inView) stop();
    }).observe(stage);
  sketch.querySelector<HTMLElement>('[data-sketch-controls]')!.hidden = false;
  instructions.hidden = false;
  sync();
}

// A soft light follows the pointer in the hero; text, links and artwork stay fixed.
const hero = document.querySelector<HTMLElement>('[data-pointer-hero]');
if (hero) {
  let frame = 0,
    x = 0,
    y = 0;
  const reset = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    hero.style.removeProperty('--pointer-x');
    hero.style.removeProperty('--pointer-y');
    hero.removeAttribute('data-pointer-active');
  };
  hero.addEventListener(
    'pointermove',
    (event) => {
      if (!finePointer.matches || event.pointerType === 'touch' || !permitted())
        return;
      const bounds = hero.getBoundingClientRect();
      x = event.clientX - bounds.left;
      y = event.clientY - bounds.top;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!permitted()) return;
          hero.style.setProperty('--pointer-x', `${x}px`);
          hero.style.setProperty('--pointer-y', `${y}px`);
          hero.dataset.pointerActive = 'true';
        });
    },
    { passive: true },
  );
  hero.addEventListener('pointerleave', reset);
  preference.addEventListener('change', reset);
  finePointer.addEventListener('change', reset);
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('pagehide', reset);
  new MutationObserver(() => {
    if (!permitted()) reset();
  }).observe(root, { attributes: true, attributeFilter: ['data-loop-motion'] });
}
