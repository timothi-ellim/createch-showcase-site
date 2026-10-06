import {
  signedToken,
  sha256,
  normaliseEmail,
  flowPage,
  type ReminderRPC,
  type ReminderConfig,
} from './reminders.ts';
export const reminderHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const errors: Record<string, [number, string]> = {
  REMINDERS_FULL: [
    503,
    'The reminder list is currently full. You can still add the event to your calendar.',
  ],
  INVALID_EMAIL: [400, 'Enter a valid email address and try again.'],
  CONSENT_REQUIRED: [
    400,
    'Please choose whether you want email reminders before continuing.',
  ],
  INVALID_LINK: [
    400,
    'This link is not valid. Request a fresh confirmation link from the signup page.',
  ],
  EXPIRED_LINK: [
    410,
    'This link has expired or reminder signup has closed. You can still save the event in your calendar.',
  ],
  REMINDERS_CLOSED: [
    410,
    'Reminder signup has closed. You can still explore the showcase.',
  ],
  TOO_MANY_REQUESTS: [
    429,
    'Please wait a little before trying again. You can still add the event to your calendar.',
  ],
  LOCAL_ONLY: [
    400,
    'This local preview accepts only synthetic addresses ending in @example.invalid.',
  ],
  INVALID_REQUEST: [
    400,
    'We couldn’t process that request. Please return to the signup page and try again.',
  ],
};
export async function boundedText(request: Request, limit = 2048) {
  if (Number(request.headers.get('content-length') ?? 0) > limit)
    throw new Error('INVALID_REQUEST');
  const reader = request.body?.getReader();
  if (!reader) return '';
  let size = 0,
    text = '';
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('INVALID_REQUEST');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
export function reminderHandler(options: {
  rpc: ReminderRPC;
  secret: string;
  origin: string;
  enabled: boolean;
  local?: boolean;
  source: (request: Request) => string;
}) {
  return async (request: Request) => {
    const json = request.headers.get('accept')?.includes('application/json');
    const reply = (
      state: string,
      title: string,
      message: string,
      status = 200,
      extra: Parameters<typeof flowPage>[2] = {},
    ) =>
      new Response(
        json
          ? JSON.stringify({ state, message })
          : flowPage(title, message, extra),
        {
          status,
          headers: {
            ...reminderHeaders,
            'Content-Type': json
              ? 'application/json; charset=utf-8'
              : 'text/html; charset=utf-8',
          },
        },
      );
    try {
      if (!options.origin || !options.secret || options.secret.length < 32)
        throw new Error('REMINDERS_UNAVAILABLE');
      const url = new URL(request.url);
      const action = url.pathname.replace(/\/$/, '').split('/').at(-1);
      if (
        url.origin !== options.origin ||
        !['subscribe', 'confirm', 'unsubscribe'].includes(action ?? '')
      )
        throw new Error('INVALID_REQUEST');
      // Opt-out stays available during a campaign pause or sending outage.
      if (!options.enabled && action !== 'unsubscribe')
        throw new Error('REMINDERS_UNAVAILABLE');
      if (
        !['GET', 'POST'].includes(request.method) ||
        (action === 'subscribe' && request.method !== 'POST')
      )
        throw new Error('INVALID_REQUEST');
      // Chrome can redact Origin on a navigation POST under no-referrer. Its
      // forbidden Fetch Metadata header still establishes same-origin navigation.
      const requestOrigin = request.headers.get('origin');
      const sameOrigin =
        requestOrigin === options.origin ||
        ((!requestOrigin || requestOrigin === 'null') &&
          request.headers.get('sec-fetch-site') === 'same-origin');
      if (
        request.method === 'POST' &&
        (!sameOrigin ||
          !request.headers
            .get('content-type')
            ?.startsWith('application/x-www-form-urlencoded'))
      )
        throw new Error('INVALID_REQUEST');
      const data =
        request.method === 'POST'
          ? new URLSearchParams(await boundedText(request))
          : url.searchParams;
      if (action === 'subscribe') {
        const email = normaliseEmail(data.get('email') ?? '');
        if (data.get('consent') !== 'yes') throw new Error('CONSENT_REQUIRED');
        if (options.local && !email.endsWith('@example.invalid'))
          throw new Error('LOCAL_ONLY');
        if (!data.get('website')) {
          const nonce = crypto.randomUUID().replaceAll('-', '');
          const confirm = await signedToken(
            options.secret,
            'confirm',
            email,
            nonce,
          );
          const unsubscribe = await signedToken(
            options.secret,
            'unsubscribe',
            email,
          );
          const result = await options.rpc('reminder_request', {
            p_email: email,
            p_source: await signedToken(
              options.secret,
              'source',
              options.source(request),
            ),
            p_nonce: nonce,
            p_confirm: await sha256(confirm),
            p_unsubscribe: await sha256(unsubscribe),
          });
          if (result === 'full') throw new Error('REMINDERS_FULL');
          if (result === 'busy') throw new Error('REMINDERS_UNAVAILABLE');
          if (result === 'limited') throw new Error('TOO_MANY_REQUESTS');
        }
        return reply(
          'received',
          'One small step. Check your inbox.',
          'Your request has been received. If a confirmation is needed, we’ll email you a link. Open it and choose Confirm my reminders. Allow up to an hour and check your spam folder.',
          202,
        );
      }
      const token = data.get('token') ?? '';
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('INVALID_LINK');
      const state = await options.rpc('reminder_token', {
        p_digest: await sha256(token),
        p_action: `${request.method === 'GET' ? 'inspect-' : ''}${action}`,
      });
      const config = await options.rpc<ReminderConfig>('reminder_config');
      if (request.method === 'GET')
        return reply(
          'review',
          action === 'confirm'
            ? 'You’re one step away.'
            : 'Leave the reminders behind?',
          action === 'confirm'
            ? 'Confirm below to receive the remaining event reminders. You can unsubscribe whenever you like.'
            : 'Choose Stop my reminders to unsubscribe. You don’t need to sign in.',
          200,
          {
            action: action as 'confirm' | 'unsubscribe',
            token,
            event: config.event,
            origin: config.origin,
          },
        );
      return reply(
        action === 'confirm' ? 'confirmed' : 'unsubscribed',
        action === 'confirm'
          ? 'You’re on the reminder list.'
          : 'Your reminders have stopped.',
        action === 'confirm'
          ? 'We’ll send the remaining reminders to your confirmed email. Make a little space in your calendar, too.'
          : 'You won’t receive further reminders from this campaign. Your own calendar entry stays under your control.',
        200,
        {
          success: true,
          event: config.event,
          origin: config.origin,
          ...(action === 'confirm' ? { schedule: state } : {}),
        },
      );
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : '';
      const [status, message] = errors[code] ?? [
        503,
        'Email reminders are temporarily unavailable. Please try again later, or save the event in your calendar.',
      ];
      return reply('error', 'Let’s try that again.', message, status);
    }
  };
}
