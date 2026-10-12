import {
  createAnalyticsConsent,
  analyticsChoiceDays,
  analyticsChoiceKey,
  analyticsMeasurementId,
  analyticsPublicOrigin,
  type AnalyticsConsent,
} from '../lib/analytics-consent';

const region = document.querySelector<HTMLElement>('[data-analytics-choice]');
if (region) {
  const host = window as Window & { createchAnalytics?: AnalyticsConsent };
  // Untagged pages and local previews can manage choices without loading Google.
  const controller =
    host.createchAnalytics ??
    createAnalyticsConsent({
      id: analyticsMeasurementId,
      origin: analyticsPublicOrigin,
      key: analyticsChoiceKey,
      days: analyticsChoiceDays,
      live: false,
    });
  const panel = region.querySelector<HTMLElement>('[data-analytics-panel]')!;
  const heading = region.querySelector<HTMLElement>('#analytics-heading')!;
  const status = region.querySelector<HTMLElement>('[data-analytics-status]')!;
  const preview = region.dataset.preview === 'true';
  function reflect() {
    panel.hidden = controller.current() !== null;
    status.hidden = true;
    region!.hidden = panel.hidden;
  }
  reflect();
  controller.pageView();
  window.addEventListener('createch:analytics-choice', reflect);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-analytics-settings]',
  )) {
    button.hidden = false;
    button.addEventListener('click', () => {
      region!.hidden = false;
      panel.hidden = false;
      status.hidden = true;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }
  function choose(value: 'granted' | 'denied') {
    const saved = controller.choose(value);
    panel.hidden = true;
    status.hidden = false;
    status.textContent = preview
      ? `Preview choice: analytics ${value === 'granted' ? 'allowed' : 'declined'}. No analytics is sent.`
      : value === 'granted'
        ? 'Analytics allowed. You can change your choice in the footer.'
        : 'Analytics off. You can change your choice in the footer.';
    if (!saved)
      status.textContent +=
        ' This browser could not save your choice. It applies to this page only; you may be asked again.';
    status.focus({ preventScroll: true });
  }
  region
    .querySelector('[data-analytics-allow]')!
    .addEventListener('click', () => choose('granted'));
  region
    .querySelector('[data-analytics-deny]')!
    .addEventListener('click', () => choose('denied'));
}
