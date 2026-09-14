export interface ControlDependencies {
  origin: string;
  authenticate: (
    authorization: string,
  ) => Promise<{
    rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }>;
  dispatch: (jobId: string) => Promise<void>;
}
// No service credentials, repository/ref overrides or commands in request bodies.
export function dispatchHandler(deps: ControlDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      'Access-Control-Allow-Origin': deps.origin,
      'Access-Control-Allow-Headers':
        'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    };
    const reply = (status: number, body: unknown) =>
      Response.json(body, { status, headers });
    if (request.headers.get('origin') !== deps.origin)
      return reply(403, { code: 'ORIGIN_DENIED' });
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { code: 'METHOD_DENIED' });
    try {
      const auth = request.headers.get('authorization');
      if (!auth?.startsWith('Bearer '))
        return reply(401, { code: 'SIGN_IN_REQUIRED' });
      const user = await deps.authenticate(auth);
      const raw = await request.text();
      if (raw.length > 256) return reply(400, { code: 'INVALID_REQUEST' });
      const body = JSON.parse(raw);
      if (
        Object.keys(body).length !== 1 ||
        typeof body.jobId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(body.jobId)
      )
        return reply(400, { code: 'INVALID_REQUEST' });
      const permission = (await user.rpc('authorise_job_dispatch', {
        p_job: body.jobId,
      })) as { status: string };
      if (permission.status !== 'queued')
        return reply(409, { code: 'JOB_NOT_QUEUED' });
      try {
        await deps.dispatch(body.jobId);
      } catch {
        return reply(503, { code: 'DISPATCH_UNAVAILABLE', queued: true });
      }
      return reply(202, { code: 'DISPATCH_ACCEPTED', queued: true });
    } catch {
      return reply(403, { code: 'REQUEST_DENIED' });
    }
  };
}
