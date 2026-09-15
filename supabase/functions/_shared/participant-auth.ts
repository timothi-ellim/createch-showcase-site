/** Provider-independent HTTP contract. All privileged operations are injected server-side. */
export interface AuthDependencies {
  origins: string[];
  pepper: string;
  network: (request: Request) => string;
  rpc: (name: string, args: Record<string, unknown>) => Promise<any>;
  send: (
    email: string,
    kind: 'invite' | 'email',
    userId: string,
  ) => Promise<'accepted' | 'rejected' | 'unknown'>;
  verify: (
    email: string,
    kind: 'invite' | 'email',
    code: string,
  ) => Promise<any>;
  organiser: (
    authorization: string,
    userId: string,
  ) => Promise<{ email: string; actor: string }>;
}
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
export async function digest(value: string) {
  return hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
}
export async function keyed(pepper: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)),
  );
}
async function boundedJSON(request: Request) {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw Error('INVALID');
  const reader = request.body?.getReader();
  if (!reader) throw Error('INVALID');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) {
      await reader.cancel();
      throw Error('INVALID');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
const exact = (body: any, fields: string[]) =>
  body &&
  !Array.isArray(body) &&
  Object.keys(body).sort().join(',') === fields.sort().join(',');
const validKey = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const validEmail = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function authHandler(
  operation: 'request' | 'verify' | 'resend',
  deps: AuthDependencies,
) {
  if (deps.pepper.length < 32 || !deps.origins.length)
    throw Error('AUTH_CONFIGURATION_REQUIRED');
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin') ?? '';
    const allowed = deps.origins.includes(origin);
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
    };
    if (allowed)
      Object.assign(headers, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers':
          'content-type,authorization,apikey,x-client-info',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Expose-Headers': 'Retry-After',
      });
    const reply = (status: number, body: any, retry?: number) =>
      Response.json(body, {
        status,
        headers: {
          ...headers,
          ...(retry ? { 'Retry-After': String(retry) } : {}),
        },
      });
    if (!allowed) return reply(403, { code: 'ORIGIN_DENIED' });
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { code: 'METHOD_DENIED' });
    let body: any;
    try {
      body = await boundedJSON(request);
    } catch {
      return reply(400, { code: 'INVALID_REQUEST' });
    }
    const fields =
      operation === 'verify'
        ? ['attemptKey', 'code']
        : operation === 'resend'
          ? ['attemptKey', 'userId']
          : ['attemptKey', 'email', 'mode'];
    if (!exact(body, fields) || !validKey(body.attemptKey))
      return reply(400, { code: 'INVALID_REQUEST' });
    if (
      operation === 'verify' &&
      (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code))
    )
      return reply(400, { code: 'INVALID_REQUEST' });
    if (
      operation === 'request' &&
      (!validEmail(body.email?.trim()) ||
        !['send', 'existing-code'].includes(body.mode))
    )
      return reply(400, { code: 'INVALID_REQUEST' });
    if (
      operation === 'resend' &&
      (typeof body.userId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.userId))
    )
      return reply(400, { code: 'INVALID_REQUEST' });
    const key = await digest(body.attemptKey);
    try {
      const network = await keyed(
        deps.pepper,
        'network:' + deps.network(request),
      );
      if (operation !== 'verify') {
        let email: string;
        let actor: string | null = null;
        if (operation === 'resend') {
          try {
            const recipient = await deps.organiser(
              request.headers.get('authorization') ?? '',
              body.userId,
            );
            email = recipient.email;
            actor = recipient.actor;
          } catch {
            return reply(403, { code: 'MFA_OR_ROLE_REQUIRED' });
          }
        } else email = body.email.trim().toLowerCase();
        email = email.toLowerCase();
        const reserve = await deps.rpc('auth_request_reserve', {
          p_key: key,
          p_email: email,
          p_email_hash: await keyed(deps.pepper, 'email:' + email),
          p_network_hash: network,
          p_origin: origin,
          p_mode: operation === 'resend' ? 'send' : body.mode,
          p_actor: actor,
        });
        if (reserve.action === 'limited')
          return reply(429, { code: 'TRY_LATER' }, reserve.retryAfterSeconds);
        if (reserve.action === 'send') {
          let outcome: 'accepted' | 'rejected' | 'unknown' = 'unknown';
          try {
            outcome = await deps.send(
              reserve.email,
              reserve.kind,
              reserve.userId,
            );
          } catch {
            /* Provider may have sent; never repeat automatically. */
          }
          await deps.rpc('auth_record_send', {
            p_key: key,
            p_outcome: outcome,
          });
          if (operation === 'resend')
            return reply(200, { status: outcome, retryAfterSeconds: 60 });
        }
        if (operation === 'resend')
          return reply(200, {
            status: ['accepted', 'rejected', 'unknown'].includes(
              reserve.sendState,
            )
              ? reserve.sendState
              : 'not_sent',
            retryAfterSeconds: 60,
          });
        return reply(202, { status: 'check_email', retryAfterSeconds: 60 });
      }
      const claim = await deps.rpc('auth_verify_claim', {
        p_key: key,
        p_origin: origin,
        p_network_hash: network,
      });
      if (claim.action === 'limited')
        return reply(429, { code: 'TRY_LATER' }, claim.retryAfterSeconds);
      if (claim.action !== 'verify')
        return reply(401, { code: 'CODE_NOT_VERIFIED' });
      let success = false;
      let uncertain = false;
      let session: any = null;
      try {
        // A changed email cannot take over an outstanding attempt.
        if (
          (await keyed(deps.pepper, 'email:' + claim.email.toLowerCase())) !==
          claim.emailHash
        )
          uncertain = true;
        else {
          const result = await deps.verify(claim.email, claim.kind, body.code);
          session = result?.session;
          success =
            !!session?.access_token &&
            !!session?.refresh_token &&
            result.user?.id === claim.userId &&
            result.user?.email?.toLowerCase() === claim.email.toLowerCase() &&
            !!result.user?.email_confirmed_at;
          if (session && !success) uncertain = true;
        }
      } catch {
        uncertain = true;
      }
      const finished = await deps.rpc('auth_verify_finish', {
        p_key: key,
        p_claim: claim.claim,
        p_user: claim.userId,
        p_success: success,
        p_uncertain: uncertain,
      });
      if (!finished || !success)
        return reply(401, { code: 'CODE_NOT_VERIFIED' });
      return reply(200, {
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        },
      });
    } catch {
      return reply(503, { code: 'SIGN_IN_UNAVAILABLE' });
    }
  };
}
