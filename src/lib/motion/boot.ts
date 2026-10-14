import { motionLevel } from './config';
import { canMove } from './preferences';
if (motionLevel !== 'off') {
  // Failure leaves the final HTML/CSS visible. Never block functional scripts.
  void import('./feedback').catch(() => {});
  if (
    motionLevel === 'full' &&
    (document.body.dataset.page === 'home' ||
      location.pathname === '/explore/' ||
      location.pathname.startsWith('/projects/'))
  ) {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let started = false;
    let loading = false;
    const startWhenVisible = () => {
      if (started || loading || !canMove()) return;
      loading = true;
      void import('./editorial')
        .then((module) => {
          // Visibility/preference may change while the chunk is in flight.
          if (!canMove()) return;
          module.startEditorial();
          started = true;
          document.removeEventListener('visibilitychange', startWhenVisible);
          document.removeEventListener(
            'createch:motion-policy',
            startWhenVisible,
          );
          preference.removeEventListener('change', startWhenVisible);
        })
        .catch(() => {})
        .finally(() => {
          loading = false;
        });
    };
    document.addEventListener('visibilitychange', startWhenVisible);
    document.addEventListener('createch:motion-policy', startWhenVisible);
    preference.addEventListener('change', startWhenVisible);
    startWhenVisible();
  }
}
