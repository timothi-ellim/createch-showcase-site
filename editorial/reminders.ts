import {
  reminderWindowLabel,
  reminderSchedule,
  eventDateLabel,
} from '../src/lib/event-time.ts';
import {
  calendarPath,
  googleCalendarUrl,
  eventAddress,
  type CalendarEvent,
} from '../src/lib/event-calendar.ts';
export type ReminderRPC = <T = any>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<T>;
export interface ReminderConfig {
  event: CalendarEvent;
  origin: string;
  revision: string;
  paused: boolean;
  ready: boolean;
  current: boolean;
  start: string;
  week: string;
  day: string;
}
export const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export const sha256 = async (value: string) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
export async function signedToken(secret: string, ...parts: string[]) {
  if (secret.length < 32) throw new Error('REMINDERS_UNAVAILABLE');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(JSON.stringify(parts)),
    ),
  );
}
export function normaliseEmail(value: string) {
  const email = value.trim();
  if (
    email.length > 254 ||
    !/^[^\s<>"(),;:\\@]+@[^\s<>"(),;:\\@]+\.[^\s<>"(),;:\\@]+$/.test(email)
  )
    throw new Error('INVALID_EMAIL');
  const split = email.lastIndexOf('@');
  return email.slice(0, split) + email.slice(split).toLowerCase();
}
export function serviceRPC(url: string, secret: string): ReminderRPC {
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !secret)
    throw new Error('REMINDERS_UNAVAILABLE');
  return async (name, args = {}) => {
    if (!/^reminder_[a-z_]+$/.test(name)) throw new Error('INVALID_RPC');
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      const safe = [
        'INVALID_LINK',
        'EXPIRED_LINK',
        'REMINDERS_UNAVAILABLE',
        'REMINDERS_CLOSED',
      ];
      throw new Error(
        safe.includes(body.message ?? '')
          ? body.message
          : 'REMINDERS_UNAVAILABLE',
      );
    }
    return response.status === 204 ? undefined : response.json();
  };
}
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  key: string;
}
export interface MailJob {
  id: string;
  lease: string;
  kind: 'confirm' | 'week' | 'day';
  revision: string;
  nonce: string;
  email: string;
  event: CalendarEvent;
  origin: string;
}
export async function reminderMail(
  job: MailJob,
  tokenSecret: string,
): Promise<Mail> {
  const confirm = `${job.origin}/api/reminders/confirm?token=${await signedToken(tokenSecret, 'confirm', job.email, job.nonce)}`;
  const unsubscribe = `${job.origin}/api/reminders/unsubscribe?token=${await signedToken(tokenSecret, 'unsubscribe', job.email)}`;
  const when = `${eventDateLabel(job.event.date)}, ${job.event.startTime}–${job.event.endTime} UK time`;
  const subject =
    job.kind === 'confirm'
      ? 'Confirm your CreaTech Showcase reminders'
      : job.kind === 'week'
        ? 'Next week: Where Code Becomes Culture'
        : 'Coming soon: Where Code Becomes Culture';
  const intro =
    job.kind === 'confirm'
      ? 'You asked for email reminders about the showcase. Confirm your address to receive only the reminders still to come. This link expires in 24 hours.'
      : job.kind === 'week'
        ? 'Make a little space for curiosity next week. Explore the projects and plan your visit.'
        : 'A little nudge before the showcase. Check the date below and the latest visitor information before travelling.';
  const action = job.kind === 'confirm' ? confirm : `${job.origin}/visit/`;
  const actionLabel =
    job.kind === 'confirm' ? 'Confirm my reminders' : 'Plan your visit';
  const signature =
    'Timothi Lim\nOn behalf of the CreaTech Showcase organising team';
  const text = `${intro}\n\n${job.event.title}\n${when}\n${eventAddress(job.event)}\n\n${actionLabel}: ${action}\nAdd to calendar: ${job.origin}${calendarPath}\n\nThis is a reminder signup, not a booking.\nUnsubscribe: ${unsubscribe}\nIf you did not request this, you can ignore this email.\n\n${signature}`;
  const html = `<html lang="en"><body style="margin:0;background:#f4f1e8;color:#1c352e;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fffdf7;border:1px solid #b8c4ac;border-radius:16px"><p style="font-size:12px;letter-spacing:2px">CREATECH SHOWCASE 2026</p><h1 style="font-size:30px;line-height:1.15">${escape(subject)}</h1><p style="line-height:1.6">${escape(intro)}</p><h2 style="font-size:20px">${escape(job.event.title)}</h2><p style="line-height:1.6">${escape(when)}<br>${escape(eventAddress(job.event))}</p><p style="margin:28px 0"><a style="display:inline-block;background:#1c352e;color:#fffdf7;padding:14px 20px;border-radius:8px;font-weight:bold" href="${escape(action)}">${actionLabel}</a></p><p><a style="color:#1c352e" href="${job.origin}${calendarPath}">Add to calendar</a></p><p style="line-height:1.6">Timothi Lim<br>On behalf of the CreaTech Showcase organising team</p><hr><p style="font-size:13px;line-height:1.5">This is a reminder signup, not a booking.<br><a style="color:#1c352e" href="${escape(unsubscribe)}">Unsubscribe</a> · <a style="color:#1c352e" href="${job.origin}/reminder-privacy/">Your email and privacy</a><br>If you did not request this, you can ignore this email.</p></main></body></html>`;
  return {
    to: job.email,
    subject,
    text,
    html,
    key: `createch-reminder/${job.id}`,
  };
}
export interface DeliveryResult {
  status: 'accepted' | 'failed' | 'uncertain';
  providerId: string | null;
  suppressed?: boolean;
}
export async function deliverBatch(
  rpc: ReminderRPC,
  secret: string,
  send: (mail: Mail) => Promise<DeliveryResult>,
  max = 10,
) {
  if (secret.length < 32) throw new Error('REMINDERS_UNAVAILABLE');
  const result = { accepted: 0, failed: 0, uncertain: 0, cancelled: 0 };
  // Leave time for the current job's bounded requests and its durable receipt.
  const deadline = Date.now() + 45000;
  for (let i = 0; i < Math.min(max, 25) && Date.now() < deadline; i++) {
    const job = await rpc<MailJob | null>('reminder_claim');
    if (!job) break;
    let receipt: DeliveryResult | { status: 'cancelled'; providerId: null };
    try {
      const mail = await reminderMail(job, secret);
      if (
        !(await rpc('reminder_send_check', {
          p_id: job.id,
          p_lease: job.lease,
        }))
      )
        receipt = { status: 'cancelled', providerId: null };
      else receipt = await send(mail);
    } catch {
      receipt = { status: 'uncertain', providerId: null };
    }
    // Receipt failure deliberately leaves the lease for uncertain-state recovery.
    await rpc('reminder_receipt', {
      p_id: job.id,
      p_lease: job.lease,
      p_status: receipt.status,
      p_provider: receipt.providerId,
    });
    if ('suppressed' in receipt && receipt.suppressed && receipt.providerId)
      await rpc('reminder_delivery_status', {
        p_provider: receipt.providerId,
        p_status: 'bounced',
      });
    result[receipt.status]++;
  }
  return result;
}
export function resendTransport(apiKey: string, from: string) {
  if (!apiKey || !from || /[\r\n]/.test(from))
    throw new Error('REMINDERS_UNAVAILABLE');
  return async (mail: Mail): Promise<DeliveryResult> => {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': mail.key,
        },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        return {
          status:
            response.status >= 500 || response.status === 409
              ? 'uncertain'
              : 'failed',
          providerId: null,
        };
      const body = (await response.json()) as { id?: string };
      return {
        status: typeof body.id === 'string' ? 'accepted' : 'uncertain',
        providerId: body.id ?? null,
      };
    } catch {
      return { status: 'uncertain', providerId: null };
    }
  };
}
export function flowPage(
  title: string,
  message: string,
  options: {
    action?: 'confirm' | 'unsubscribe';
    token?: string;
    event?: CalendarEvent;
    origin?: string;
    schedule?: { week?: string | null; day?: string | null };
    success?: boolean;
  } = {},
) {
  const { event, origin } = options;
  const calendar =
    event && origin
      ? `<div class="calendar-picker"><div class="calendar-options"><a href="${escape(googleCalendarUrl(event, origin))}" target="_blank" rel="noopener noreferrer"><strong>Google Calendar ↗</strong><span>Opens in a new tab</span></a><a href="${calendarPath}" download><strong>Apple, Outlook & other calendars ↓</strong><span>Download the calendar file</span></a><p>Save the event in your calendar app to finish.</p></div></div>`
      : `<a href="${calendarPath}" download>Add to calendar (.ics)</a>`;
  const dates = options.schedule
    ? reminderSchedule(event!)
        .filter((item) => options.schedule![item.kind as 'week' | 'day'])
        .map(
          (item) =>
            `<li>${escape(reminderWindowLabel(item, event!.timeZone))}</li>`,
        )
        .join('')
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${escape(title)} · CreaTech Showcase</title><link rel="stylesheet" href="/reminder-flow.css"></head><body><div class="wrap"><a class="flow-nav" href="/">CreaTech Showcase · Back to the guide</a><main class="reminder-page"><p class="event-kicker">A date for your curiosity</p>${options.success ? '<span class="reminder-success-icon" aria-hidden="true">✓</span>' : ''}<h1>${escape(title)}</h1><p>${escape(message)}</p>${event ? `<p><strong>${escape(event.title)}</strong><br>${escape(eventDateLabel(event.date))} · ${escape(event.startTime)}–${escape(event.endTime)} UK time<br>${escape(eventAddress(event))}</p>` : ''}${options.action ? `<form method="post" action="/api/reminders/${options.action}" class="flow-action"><input type="hidden" name="token" value="${escape(options.token ?? '')}"><button type="submit" class="reminder-submit">${options.action === 'confirm' ? 'Confirm my reminders' : 'Stop my reminders'}</button></form>` : ''}${options.schedule ? (dates ? `<h2>Your remaining reminders</h2><ul>${dates}</ul>` : '<p>No scheduled reminders remain. The event details are here whenever you need them.</p>') : ''}<div class="flow-action">${calendar}</div><div class="flow-links"><a href="/visit/">Plan your visit</a><a href="/reminders/">Email reminder signup</a></div><p class="reminder-privacy">This is a reminder signup, not a booking. <a href="/reminder-privacy/">Your email and privacy</a>.</p></main></div></body></html>`;
}
