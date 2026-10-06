import { countdown } from '../lib/event-time';
function update() {
  document
    .querySelectorAll<HTMLElement>('[data-event-actions]')
    .forEach((root) => {
      const result = countdown(
        Number(root.dataset.start),
        Number(root.dataset.end),
      );
      const box = root.querySelector<HTMLElement>('[data-event-countdown]')!;
      const caption = root.querySelector<HTMLElement>(
        '[data-countdown-caption]',
      )!;
      box.hidden = false;
      root.querySelector<HTMLElement>('[data-countdown-digits]')!.hidden =
        result.state !== 'before';
      caption.textContent =
        result.state === 'ended'
          ? 'The event has ended. Keep exploring the projects.'
          : result.state === 'today'
            ? 'The showcase is scheduled today.'
            : 'Until the showcase';
      for (const part of ['days', 'hours', 'minutes'] as const)
        root.querySelector<HTMLElement>(`[data-count-${part}]`)!.textContent =
          String(result[part]).padStart(2, '0');
      const reminder = root.querySelector<HTMLAnchorElement>(
        '[data-reminder-link]',
      );
      if (reminder && result.state !== 'before') {
        reminder.href = '/explore/';
        reminder.querySelector('strong')!.textContent = 'Explore the projects';
        reminder.querySelector('small')!.textContent =
          'Keep following your curiosity.';
      }
    });
}
update();
setInterval(() => {
  if (!document.hidden) update();
}, 60000);
document.addEventListener('visibilitychange', update);
