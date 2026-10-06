import {
  deliverBatch,
  serviceRPC,
  sha256,
} from '../../../editorial/reminders.ts';
import { gmailTransport } from '../../../editorial/reminders-gmail.ts';
Deno.serve(async (request) => {
  const secret = Deno.env.get('REMINDERS_SCHEDULER_SECRET');
  if (
    !secret ||
    secret.length < 32 ||
    request.method !== 'POST' ||
    (await sha256(request.headers.get('authorization') ?? '')) !==
      (await sha256(`Bearer ${secret}`))
  )
    return new Response('Not authorised', { status: 401 });
  let stage = 'cleanup';
  try {
    const rpc = serviceRPC(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    await rpc('reminder_cleanup');
    stage = 'smtp';
    const gmail = gmailTransport(
      Deno.env.get('REMINDERS_GMAIL_USER') ?? '',
      Deno.env.get('REMINDERS_GMAIL_APP_PASSWORD') ?? '',
    );
    if (new URL(request.url).searchParams.get('check') === 'smtp') {
      await gmail.verify();
      return Response.json({ smtp: 'verified' });
    }
    // Retention must continue when outgoing mail has been disabled.
    if (Deno.env.get('REMINDERS_DELIVERY_ENABLED') !== 'true')
      return Response.json({ delivery: 'disabled' });
    stage = 'delivery';
    const result = await deliverBatch(
      rpc,
      Deno.env.get('REMINDERS_TOKEN_SECRET') ?? '',
      gmail.send,
      10,
    );
    return Response.json(result);
  } catch (reason) {
    const code = (reason as { code?: string }).code ?? '';
    const safeCode = ['EAUTH', 'ECONNECTION', 'EDNS', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED'].includes(code) ? code : 'UNAVAILABLE';
    return Response.json({ error: 'Reminder worker needs attention', stage, code: safeCode }, { status: 503 });
  }
});
