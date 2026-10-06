import { escapeHtml as e } from '../lib/project-renderer';
import type { WorkspaceAPI } from './portal-presence';
interface Stats {
  capacity: number;
  dailyLimit: number;
  attempted24h: number;
  active: number;
  pending: number;
  recent: number;
  unsubscribed: number;
  suppressed: number;
  attention: number;
  accepted: number;
  next: string | null;
  asOf: string;
  paused: boolean;
  ready: boolean;
  current: boolean;
}
export async function showReminderStats(
  content: HTMLElement,
  api: WorkspaceAPI,
) {
  content.innerHTML = '<p role="status">Loading reminder totals…</p>';
  try {
    const stats = await api.rpc<Stats>('reminder_stats');
    const date = (value: string) =>
      new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/London',
      }).format(new Date(value));
    content.innerHTML = `<section class="reminder-admin"><div class="reminder-admin-heading"><div><p class="eyebrow">Visitor interest · private to organisers</p><h2>Event reminders</h2></div><button class="button secondary" data-refresh-reminders>Refresh totals</button></div><div class="reminder-admin-count"><strong>${stats.active}</strong><span>Active confirmed reminder subscribers</span><p>Unique confirmed email subscriptions. This is not an attendance or booking count.</p></div><dl class="reminder-admin-metrics">${[
      ['Awaiting confirmation', stats.pending],
      ['Campaign capacity', stats.capacity],
      ['Send attempts in the last 24 hours', stats.attempted24h],
      ['Confirmed in the last 7 days', stats.recent],
      ['Unsubscribed', stats.unsubscribed],
      ['Suppressed addresses', stats.suppressed],
      ['Messages accepted by provider', stats.accepted],
      ['Deliveries needing attention', stats.attention],
    ]
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
      .join(
        '',
      )}</dl><section class="reading-panel"><h3>${!stats.ready ? 'Delivery is not configured' : !stats.current ? 'Event information needs review' : stats.paused ? 'Reminders are paused' : 'Reminders are active'}</h3><p>${!stats.ready ? 'The sender, privacy notice and delivery checks must be completed before this campaign can open.' : !stats.current ? 'Sending is held because the campaign no longer matches the verified public event. Review the campaign configuration before resuming.' : stats.paused ? 'New signups and sends are on hold. People can still unsubscribe.' : 'Confirmed subscribers will receive only the reminders still to come.'}</p><p>Gmail campaign limit: ${stats.dailyLimit} attempts per rolling 24 hours. Reminders are staggered across two days. Check the Gmail inbox for delayed bounce notices and contact the site maintainer to suppress affected addresses.</p><p>Next queued message: ${stats.next ? e(date(stats.next)) + ' UK time' : 'None scheduled'}.</p>${stats.ready && stats.current ? `<button class="button dark" data-toggle-reminders>${stats.paused ? 'Resume reminders' : 'Pause reminders'}</button>` : ''}${stats.attention ? '<p>Some messages failed, were interrupted or missed their sending window. Check delivery receipts before retrying; uncertain sends are never automatically repeated.</p>' : ''}</section><p class="small">Totals retrieved ${e(date(stats.asOf))} UK time. Provider acceptance does not establish inbox delivery or reading.</p></section>`;
    content
      .querySelector('[data-refresh-reminders]')!
      .addEventListener('click', () =>
        api.act(() => showReminderStats(content, api)),
      );
    if (stats.attention) {
      const jobs = await api.rpc<
        Array<{
          id: string;
          kind: string;
          status: string;
          dueAt: string;
          canRetry: boolean;
        }>
      >('reminder_attention');
      const section = document.createElement('section');
      section.className = 'reading-panel';
      section.innerHTML = `<h3>Delivery attention</h3><p>Only definite failures within their sending window can be retried here. Check uncertain sends with the provider before taking further action.</p>${jobs.map((job) => `<p>${e(job.kind === 'confirm' ? 'Confirmation' : job.kind === 'week' ? 'Week-before reminder' : 'Day-before reminder')} · ${e(job.status)} · ${e(date(job.dueAt))} ${job.canRetry ? `<button class="button secondary" data-retry-mail="${e(job.id)}">Retry failed message</button>` : ''}</p>`).join('')}`;
      content.querySelector('.reminder-admin')!.append(section);
      section.querySelectorAll<HTMLButtonElement>('[data-retry-mail]').forEach(
        (button) =>
          (button.onclick = () => {
            void api.act(async () => {
              await api.rpc('reminder_retry', {
                p_id: button.dataset.retryMail,
              });
              await showReminderStats(content, api);
              api.say('Failed message queued for another attempt.');
            });
          }),
      );
    }
    content
      .querySelector('[data-toggle-reminders]')
      ?.addEventListener('click', () =>
        api.act(async () => {
          await api.rpc('reminder_pause', { p_paused: !stats.paused });
          await showReminderStats(content, api);
          api.say(
            stats.paused
              ? 'Reminders resumed.'
              : 'Reminders paused. Unsubscribe remains available.',
          );
        }),
      );
  } catch {
    content.innerHTML =
      '<section class="reading-panel"><h2>Reminder totals are unavailable.</h2><p>Verify organiser access and MFA, then try again. The reminder service may still need to be configured.</p><button class="button dark" data-retry-reminders>Try again</button></section>';
    content
      .querySelector('[data-retry-reminders]')!
      .addEventListener('click', () =>
        api.act(() => showReminderStats(content, api)),
      );
    api.say(
      'Reminder totals could not be loaded. No count is being shown.',
      true,
    );
  }
}
