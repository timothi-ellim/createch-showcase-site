const preference = matchMedia('(prefers-reduced-motion: reduce)');
const cancellations = new Set<() => void>();
export const canMove = () =>
  !preference.matches &&
  !document.hidden &&
  document.documentElement.dataset.motionLevel !== 'off';
export function track(cancel: () => void) {
  cancellations.add(cancel);
  return () => cancellations.delete(cancel);
}
export function settle() {
  for (const cancel of [...cancellations]) cancel();
}
preference.addEventListener('change', settle);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) settle();
});
window.addEventListener('pagehide', settle);
window.addEventListener('resize', settle);
document.addEventListener('focusin', settle);
