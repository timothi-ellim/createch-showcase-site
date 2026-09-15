import { motionLevel } from './config';
if (motionLevel !== 'off') {
  // Failure leaves the final HTML/CSS visible. Never block functional scripts.
  void import('./feedback').catch(() => {});
  if (
    motionLevel === 'full' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches &&
    (document.body.dataset.page === 'home' ||
      location.pathname === '/explore/' ||
      location.pathname.startsWith('/projects/'))
  ) {
    void import('./editorial')
      .then((module) => module.startEditorial())
      .catch(() => {});
  }
}
