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
  const blend = sketch.querySelector<HTMLInputElement>('[data-sketch-blend]')!;
  const output = sketch.querySelector<HTMLOutputElement>(
    '[data-sketch-output]',
  )!;
  const instructions = sketch.querySelector<HTMLElement>(
    '[data-sketch-instructions]',
  )!;
  const names = ['Orbit', 'Wave', 'Bloom'];
  let rotation: ReturnType<typeof animate> | undefined;
  let morph: ReturnType<typeof animate> | undefined;
  let inView = true;
  let selectedShape = 0;
  let targetYaw = pose.yaw,
    targetPitch = pose.pitch;
  let manualView = false;
  let frame = 0;
  let drag:
    | {
        id: number;
        x: number;
        y: number;
        yaw: number;
        pitch: number;
        touch: boolean;
      }
    | undefined;
  const draw = () =>
    sketchPaths(pose).forEach((d, i) => paths[i].setAttribute('d', d));
  const endDrag = (event?: Event) => {
    if (drag && event && 'pointerId' in event && event.pointerId !== drag.id)
      return;
    if (drag) {
      if (event?.type === 'pointercancel') {
        targetYaw = drag.yaw;
        targetPitch = drag.pitch;
      }
      cancelAnimationFrame(frame);
      frame = 0;
      pose.yaw = targetYaw;
      pose.pitch = targetPitch;
      draw();
    }
    const id = drag?.id;
    drag = undefined;
    delete stage.dataset.dragging;
    if (id !== undefined && stage.hasPointerCapture(id))
      stage.releasePointerCapture(id);
  };
  const stop = () => {
    rotation?.stop();
    morph?.stop();
    rotation = morph = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    endDrag();
    pose.shape = selectedShape;
    pose.yaw = targetYaw;
    pose.pitch = targetPitch;
    draw();
  };
  const syncShape = () => {
    const exact = Number.isInteger(selectedShape);
    const lower = Math.floor(selectedShape),
      upper = Math.ceil(selectedShape);
    const label = exact ? names[lower] : `${names[lower]} / ${names[upper]}`;
    buttons.forEach((button, index) =>
      button.setAttribute('aria-pressed', String(selectedShape === index)),
    );
    blend.value = String(Math.round(selectedShape * 50));
    blend.setAttribute(
      'aria-valuetext',
      exact
        ? label
        : `${Math.round((selectedShape - lower) * 100)}% from ${names[lower]} to ${names[upper]}`,
    );
    output.textContent = label;
    sketch.querySelector('[data-sketch-label]')!.textContent = exact
      ? `0${lower + 1} — ${label}`
      : label;
  };
  const chooseShape = (value: number, transition = true) => {
    selectedShape = Math.max(0, Math.min(2, value));
    morph?.stop();
    syncShape();
    if (!transition || !permitted() || !inView) {
      pose.shape = selectedShape;
      draw();
      return;
    }
    morph = animate(pose.shape, selectedShape, {
      duration: 0.75,
      ease: [0.4, 0, 0.2, 1],
      onUpdate: (value) => {
        pose.shape = value;
        draw();
      },
    });
  };
  const rotate = (yaw: number, pitch: number) => {
    rotation?.stop();
    targetYaw = yaw;
    targetPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    const start = { ...pose };
    if (!permitted() || !inView) {
      pose.yaw = targetYaw;
      pose.pitch = targetPitch;
      draw();
      return;
    }
    rotation = animate(0, 1, {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (t) => {
        pose.yaw = start.yaw + (targetYaw - start.yaw) * t;
        pose.pitch = start.pitch + (targetPitch - start.pitch) * t;
        draw();
      },
    });
  };
  const reset = () => {
    endDrag();
    manualView = false;
    chooseShape(0);
    rotate(restingPose.yaw, restingPose.pitch);
  };
  buttons.forEach((button, index) =>
    button.addEventListener('click', () => chooseShape(index)),
  );
  blend.addEventListener('input', () =>
    chooseShape(Number(blend.value) / 50, false),
  );
  sketch.querySelector('[data-sketch-reset]')?.addEventListener('click', reset);
  sketch.querySelector('[data-sketch-turn]')?.addEventListener('click', () => {
    manualView = true;
    rotate(targetYaw + Math.PI / 3, targetPitch);
  });
  stage.addEventListener('keydown', (event) => {
    if (event.target !== stage) return;
    const step = Math.PI / 8;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key === 'Home') {
      event.preventDefault();
      reset();
      return;
    }
    const change = directions[event.key];
    if (!change) return;
    event.preventDefault();
    manualView = true;
    rotate(targetYaw + change[0], targetPitch + change[1]);
  });
  stage.addEventListener('pointerdown', (event) => {
    if (!permitted() || !inView || !event.isPrimary || event.button !== 0)
      return;
    rotation?.stop();
    manualView = true;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: pose.yaw,
      pitch: pose.pitch,
      touch: event.pointerType === 'touch',
    };
    targetYaw = pose.yaw;
    targetPitch = pose.pitch;
    stage.setPointerCapture(event.pointerId);
    stage.dataset.dragging = 'true';
    stage.focus({ preventScroll: true });
  });
  stage.addEventListener(
    'pointermove',
    (event) => {
      if (!inView || !permitted()) return;
      const rect = stage.getBoundingClientRect();
      if (drag) {
        if (event.pointerId !== drag.id) return;
        targetYaw =
          drag.yaw + ((event.clientX - drag.x) / rect.width) * Math.PI * 2;
        targetPitch = drag.touch
          ? drag.pitch
          : Math.max(
              -Math.PI / 2,
              Math.min(
                Math.PI / 2,
                drag.pitch + ((event.clientY - drag.y) / rect.height) * Math.PI,
              ),
            );
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (!drag || !permitted() || !inView) return;
            pose.yaw = targetYaw;
            pose.pitch = targetPitch;
            draw();
          });
        return;
      }
      if (manualView || event.pointerType === 'touch' || !finePointer.matches)
        return;
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
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    stage.addEventListener(type, endDrag);
  stage.addEventListener('pointerleave', () => {
    if (!manualView && !drag && inView && permitted())
      rotate(restingPose.yaw, restingPose.pitch);
  });
  const sync = () => {
    if (!permitted()) stop();
    stage.dataset.interactiveMotion = String(permitted());
    instructions.textContent = !permitted()
      ? 'Motion is paused. Shape, blend, turn and reset controls still work without animation.'
      : finePointer.matches
        ? 'Move your pointer to explore. Drag to keep a new angle, or focus the drawing and use arrow keys. Home resets.'
        : 'Drag sideways to turn, or use the controls. Swipe up and down to keep scrolling. Arrow keys also turn; Home resets.';
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
  stage.tabIndex = 0;
  sketch.querySelector<HTMLElement>('[data-sketch-controls]')!.hidden = false;
  instructions.hidden = false;
  syncShape();
  sync();
}
