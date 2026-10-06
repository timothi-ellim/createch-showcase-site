import { boundedText, reminderHeaders } from './reminders-http.ts';
import type { ReminderRPC } from './reminders.ts';
/** Svix's documented raw-body HMAC protocol, using WebCrypto verification. */
export async function verifyMailWebhook(
  request: Request,
  secret: string,
  now = Date.now(),
) {
  const timestamp = request.headers.get('svix-timestamp') ?? '';
  const id = request.headers.get('svix-id') ?? '';
  if (
    request.method !== 'POST' ||
    !secret.startsWith('whsec_') ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Number(timestamp) * 1000 - now) > 300000 ||
    !id ||
    id.length > 200
  )
    throw new Error('INVALID_SIGNATURE');
  const body = await boundedText(request, 65536);
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  let verified = false;
  for (const signature of (request.headers.get('svix-signature') ?? '')
    .split(' ')
    .slice(0, 8)) {
    if (!signature.startsWith('v1,')) continue;
    try {
      if (
        await crypto.subtle.verify(
          'HMAC',
          key,
          Uint8Array.from(atob(signature.slice(3)), (c) => c.charCodeAt(0)),
          signed,
        )
      )
        verified = true;
    } catch {
      /* Invalid candidate signature. */
    }
  }
  if (!verified) throw new Error('INVALID_SIGNATURE');
  return JSON.parse(body) as { type?: string; data?: { email_id?: string } };
}
export async function mailWebhook(
  request: Request,
  secret: string,
  rpc: ReminderRPC,
) {
  let event: Awaited<ReturnType<typeof verifyMailWebhook>>;
  try {
    event = await verifyMailWebhook(request, secret);
  } catch {
    return new Response('Invalid webhook', {
      status: 400,
      headers: reminderHeaders,
    });
  }
  try {
    if (
      ['email.bounced', 'email.complained'].includes(event.type ?? '') &&
      typeof event.data?.email_id === 'string'
    )
      await rpc('reminder_delivery_status', {
        p_provider: event.data.email_id,
        p_status: event.type!.split('.')[1],
      });
    return new Response('Received', { headers: reminderHeaders });
  } catch {
    return new Response('Please retry', {
      status: 503,
      headers: reminderHeaders,
    });
  }
}
