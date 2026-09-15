import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { appOrigins } from '../_shared/origins.ts';
const required = (key: string) => {
  const v = Deno.env.get(key);
  if (!v) throw new Error('CONFIGURATION_REQUIRED');
  return v;
};
const origin = required('PORTAL_APP_ORIGIN'),
  url = required('SUPABASE_URL');
Deno.serve(async (request) => {
  const allowed = appOrigins(
    origin,
    Deno.env.get('PORTAL_COMPATIBILITY_ORIGINS'),
    Deno.env.get('PORTAL_COMPATIBILITY_UNTIL'),
  );
  const requestOrigin = request.headers.get('origin') ?? '';
  const headers = {
    'Access-Control-Allow-Origin': allowed.includes(requestOrigin)
      ? requestOrigin
      : origin,
    'Access-Control-Allow-Headers':
      'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  const reply = (status: number, body: unknown) =>
    Response.json(body, { status, headers });
  if (!allowed.includes(requestOrigin))
    return reply(403, { code: 'ORIGIN_DENIED' });
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { code: 'METHOD_DENIED' });
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer '))
      return reply(401, { code: 'SIGN_IN_REQUIRED' });
    const user = createClient(url, required('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const verified = await user.auth.getUser();
    if (verified.error || !verified.data.user)
      return reply(401, { code: 'SIGN_IN_REQUIRED' });
    const raw = await request.text();
    if (raw.length > 1000) return reply(400, { code: 'INVALID_REQUEST' });
    const body = JSON.parse(raw);
    if (
      Object.keys(body).sort().join(',') !==
        'email,projectId,requestId,sendInvitation' ||
      body.sendInvitation !== true
    )
      return reply(400, { code: 'EXPLICIT_INVITATION_REQUIRED' });
    const reservation = await user.rpc('begin_provisioning', {
      p_request: body.requestId,
      p_project: body.projectId,
      p_email: body.email,
    });
    if (reservation.error) return reply(403, { code: 'PROVISIONING_DENIED' });
    if (reservation.data.action === 'complete') {
      const receipt = await user.rpc('invitation_receipt', {
        p_request: body.requestId,
      });
      return receipt.data === true
        ? reply(200, { code: 'ACCOUNT_PROVISIONED' })
        : reply(409, { code: 'OWNER_REVIEW_REQUIRED' });
    }
    if (reservation.data.action !== 'create')
      return reply(409, { code: 'OWNER_REVIEW_REQUIRED' });
    const admin = createClient(url, required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Explicit organiser action: actual invite is necessary for first sign-in
    // while public signup remains disabled. Never set email_confirm:true.
    const created = await admin.auth.admin.inviteUserByEmail(
      reservation.data.email,
    );
    if (created.error || !created.data.user)
      return reply(409, { code: 'OWNER_REVIEW_REQUIRED' });
    const invitation = await admin.rpc('worker_record_invitation', {
      p_request: body.requestId,
    });
    if (invitation.error) return reply(409, { code: 'OWNER_REVIEW_REQUIRED' });
    const bound = await admin.rpc('worker_finish_provisioning', {
      p_request: body.requestId,
      p_user: created.data.user.id,
    });
    if (bound.error) return reply(409, { code: 'OWNER_REVIEW_REQUIRED' });
    return reply(201, { code: 'ACCOUNT_PROVISIONED' });
  } catch {
    return reply(503, { code: 'PROVISIONING_UNCONFIRMED' });
  }
});
