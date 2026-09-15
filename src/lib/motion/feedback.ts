import { canMove, track, settle } from './preferences';
import { motionDuration, motionEase } from './tokens';
const active = new Map<Element, () => void>();
export function feedback(
  target: Element | null,
  saved = false,
  duration: number = motionDuration.micro,
) {
  if (!target) return;
  active.get(target)?.();
  if (
    !canMove() ||
    !(target instanceof HTMLElement) ||
    target.hidden ||
    !target.getClientRects().length
  )
    return;
  const frames = saved
    ? [
        { transform: 'scale(1)' },
        { transform: 'scale(.97)' },
        { transform: 'scale(1)' },
      ]
    : [{ opacity: 0.96 }, { opacity: 1 }];
  const animation = target.animate(frames, {
    duration,
    easing: `cubic-bezier(${motionEase.direct.join(',')})`,
  });
  const clear = () => {
    animation.cancel();
    active.delete(target);
    untrack();
  };
  const untrack = track(clear);
  active.set(target, clear);
  animation.finished.then(clear, () => {});
}
document.addEventListener('click', settle, true);
document.addEventListener('createch:save-feedback', ((event: CustomEvent) =>
  feedback(event.detail.target, event.detail.saved)) as EventListener);
document.addEventListener('createch:status-feedback', ((event: CustomEvent) => {
  if (event.detail.error) {
    settle();
    return;
  }
  feedback(event.detail.target);
}) as EventListener);
document.addEventListener('createch:preview-feedback', ((event: CustomEvent) =>
  feedback(event.detail.target, false, motionDuration.ui)) as EventListener);
