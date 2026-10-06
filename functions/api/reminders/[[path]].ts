import { reminderHandler } from '../../../editorial/reminders-http';
import { serviceRPC } from '../../../editorial/reminders';
import { mailWebhook } from '../../../editorial/reminders-webhook';
import { reminderHeaders } from '../../../editorial/reminders-http';
interface Env {
  REMINDERS_ENABLED?: string;
  REMINDERS_ORIGIN: string;
  REMINDERS_TOKEN_SECRET: string;
  REMINDERS_SUPABASE_URL: string;
  REMINDERS_SUPABASE_SECRET: string;
  REMINDERS_WEBHOOK_SECRET: string;
}
export async function onRequest({
  request,
  env,
}: {
  request: Request;
  env: Env;
}) {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  if (path === '/api/reminders/version' && request.method === 'GET')
    return Response.json(
      { build: '__CREATECH_REMINDER_BUILD__' },
      { headers: reminderHeaders },
    );
  const rpc: ReturnType<typeof serviceRPC> = async (name, args) =>
    serviceRPC(env.REMINDERS_SUPABASE_URL, env.REMINDERS_SUPABASE_SECRET)(
      name,
      args,
    );
  if (path === '/api/reminders/webhook')
    return mailWebhook(request, env.REMINDERS_WEBHOOK_SECRET ?? '', rpc);
  return reminderHandler({
    enabled: env.REMINDERS_ENABLED === 'true',
    origin: env.REMINDERS_ORIGIN,
    secret: env.REMINDERS_TOKEN_SECRET,
    rpc,
    source: (req) => req.headers.get('cf-connecting-ip') ?? 'unknown',
  })(request);
}
