// Decorative motion starts only after an accessible pause control is available.
const control = document.querySelector<HTMLButtonElement>(
  '[data-motion-toggle]',
);
if (control) {
  const root = document.documentElement;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'createch-motion-paused';
  let paused = false;
  try {
    paused = localStorage.getItem(storageKey) === 'true';
  } catch {
    /* This page still supports pausing. */
  }

  const update = () => {
    const unavailable =
      preference.matches || root.dataset.motionLevel !== 'full';
    root.dataset.loopMotion =
      !paused && !unavailable && !document.hidden ? 'running' : 'paused';
    control.disabled = unavailable;
    control.textContent = unavailable
      ? 'Reduced motion on'
      : paused
        ? 'Resume animations'
        : 'Pause animations';
  };
  control.addEventListener('click', () => {
    paused = !paused;
    try {
      localStorage.setItem(storageKey, String(paused));
    } catch {
      /* Keep the local control working. */
    }
    update();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) {
      paused = event.newValue === 'true';
      update();
    }
  });
  preference.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pageshow', update);
  window.addEventListener('pagehide', () => {
    root.dataset.loopMotion = 'paused';
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        (entry.target as HTMLElement).dataset.inView = String(
          entry.isIntersecting,
        );
      }
    });
    document
      .querySelectorAll<HTMLElement>('[data-ambient]')
      .forEach((element) => observer.observe(element));
  }
  control.hidden = false;
  update();
}
