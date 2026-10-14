import { canMove } from '../lib/motion/preferences';

// Decorations only: links, text, focus order and scrolling retain native behaviour.
export function startHomeInteractions() {
  const root = document.documentElement;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fields = [
    ...document.querySelectorAll<HTMLElement>('[data-motion-field]'),
  ];
  const words = [...document.querySelectorAll<HTMLElement>('.hero .word-ink')];
  const surfaces = [
    ...document.querySelectorAll<HTMLElement>(
      '.news-links a, .featured-grid .project-card, .theme-tile, .welcome-paths a',
    ),
  ];
  surfaces.forEach((surface) => {
    surface.dataset.motionSurface = '';
  });
  const rules = [
    ...document.querySelectorAll<HTMLElement>(
      'main .section-heading, .news-heading, .supporters-heading, .event-overview-intro, .poster-feature-copy, .supporters-logos',
    ),
  ];
  rules.forEach((rule) => {
    rule.dataset.motionRule = '';
  });
  const visibleFields = new Set<HTMLElement>();
  const touched = new Set<HTMLElement>();
  let frame = 0;
  let pointer: { x: number; y: number; target: Element } | null = null;
  const enabled = () =>
    canMove() &&
    root.dataset.motionLevel === 'full' &&
    root.dataset.loopMotion === 'running' &&
    !document.querySelector('dialog[open]');
  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, n));
  const properties = [
    '--response-x',
    '--response-y',
    '--response-rx',
    '--response-ry',
    '--response-near',
    '--light-x',
    '--light-y',
  ];
  const clearPointer = () => {
    for (const element of touched) {
      properties.forEach((name) => element.style.removeProperty(name));
      delete element.dataset.motionActive;
    }
    touched.clear();
  };
  const reset = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pointer = null;
    clearPointer();
    fields.forEach((field) => field.style.removeProperty('--scroll-drift'));
  };
  const paint = () => {
    frame = 0;
    if (!enabled()) {
      reset();
      return;
    }
    // Read geometry together before writing styles; never run an idle frame loop.
    const drift = [...visibleFields].map((field) => ({
      field,
      rect: field.getBoundingClientRect(),
    }));
    const target = pointer?.target;
    const field = target?.closest<HTMLElement>('[data-motion-field]');
    const surface = target?.closest<HTMLElement>('[data-motion-surface]');
    const focused = target?.closest(':focus-visible');
    const fieldRect = field?.getBoundingClientRect();
    const surfaceRect = surface?.getBoundingClientRect();
    const wordRects = field?.classList.contains('hero')
      ? words.map((word) => ({
          word,
          rect: word.parentElement!.getBoundingClientRect(),
        }))
      : [];
    clearPointer();
    for (const { field: area, rect } of drift) {
      const progress = clamp(
        (window.innerHeight / 2 - rect.top - rect.height / 2) /
          window.innerHeight,
        -1,
        1,
      );
      area.style.setProperty(
        '--scroll-drift',
        `${(progress * 28).toFixed(2)}px`,
      );
    }
    if (!pointer || !fine.matches || focused) return;
    const set = (element: HTMLElement, values: Record<string, string>) => {
      touched.add(element);
      element.dataset.motionActive = '';
      for (const [name, value] of Object.entries(values))
        element.style.setProperty(name, value);
    };
    if (field && fieldRect) {
      const x = pointer.x - fieldRect.left;
      const y = pointer.y - fieldRect.top;
      set(field, {
        '--light-x': `${x}px`,
        '--light-y': `${y}px`,
        '--response-x': `${(clamp(x / fieldRect.width - 0.5, -0.5, 0.5) * 22).toFixed(2)}px`,
        '--response-y': `${(clamp(y / fieldRect.height - 0.5, -0.5, 0.5) * 18).toFixed(2)}px`,
      });
    }
    if (surface && surfaceRect && !surface.matches(':focus-within')) {
      const x = clamp(
        (pointer.x - surfaceRect.left) / surfaceRect.width - 0.5,
        -0.5,
        0.5,
      );
      const y = clamp(
        (pointer.y - surfaceRect.top) / surfaceRect.height - 0.5,
        -0.5,
        0.5,
      );
      set(surface, {
        '--light-x': `${pointer.x - surfaceRect.left}px`,
        '--light-y': `${pointer.y - surfaceRect.top}px`,
        '--response-rx': `${(-y * 3).toFixed(2)}deg`,
        '--response-ry': `${(x * 3).toFixed(2)}deg`,
      });
    }
    for (const { word, rect } of wordRects) {
      const dx = pointer.x - rect.left - rect.width / 2;
      const dy = pointer.y - rect.top - rect.height / 2;
      const near = clamp(1 - Math.hypot(dx, dy) / 340, 0, 1);
      set(word, {
        '--response-x': `${(clamp(dx / 20, -7, 7) * near).toFixed(2)}px`,
        '--response-y': `${(clamp(dy / 20, -5, 5) * near).toFixed(2)}px`,
        '--response-near': near.toFixed(3),
      });
    }
  };
  const schedule = () => {
    if (!frame && enabled()) frame = requestAnimationFrame(paint);
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (fields.includes(element)) {
          if (entry.isIntersecting) visibleFields.add(element);
          else {
            visibleFields.delete(element);
            element.style.removeProperty('--scroll-drift');
          }
        }
        if (entry.isIntersecting && rules.includes(element)) {
          element.dataset.motionEntered = '';
          observer.unobserve(element);
        }
      }
      schedule();
    },
    { threshold: 0.08 },
  );
  [...fields, ...rules].forEach((element) => observer.observe(element));
  document.addEventListener(
    'pointermove',
    (event) => {
      if (
        event.pointerType === 'touch' ||
        !fine.matches ||
        !enabled() ||
        !(event.target instanceof Element)
      )
        return;
      pointer = { x: event.clientX, y: event.clientY, target: event.target };
      schedule();
    },
    { passive: true },
  );
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) reset();
  });
  document.addEventListener('pointercancel', reset);
  document.addEventListener('focusin', reset);
  document.addEventListener('keydown', reset);
  window.addEventListener(
    'scroll',
    () => {
      pointer = null;
      clearPointer();
      schedule();
    },
    { passive: true },
  );
  window.addEventListener('resize', reset);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  document.addEventListener('createch:motion-policy', () => {
    reset();
    schedule();
  });
  fine.addEventListener('change', reset);
  reduced.addEventListener('change', reset);
  window.addEventListener('pagehide', reset);
  window.addEventListener('pageshow', schedule);
  schedule();
}
