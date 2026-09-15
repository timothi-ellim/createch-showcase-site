import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { authHandler } from './participant-auth.ts';
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw Error('AUTH_CONFIGURATION_REQUIRED');
  return value;
};
export function hostedAuth(operation: 'request' | 'verify' | 'resend') {
  const url = required('SUPABASE_URL'),
    secret = required('SUPABASE_SERVICE_ROLE_KEY'),
    pub = required('SUPABASE_ANON_KEY');
  const origins = required('PARTICIPANT_AUTH_ORIGINS')
    .split(',')
    .map((x) => x.trim());
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      (parsed.protocol !== 'https:' &&
        !(
          parsed.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(parsed.hostname)
        ))
    )
      throw Error('AUTH_ORIGIN_INVALID');
  }
  // Set only in the exact release after verifying the provider hook and expiry.
  if (required('PARTICIPANT_AUTH_RELEASE_READY') !== '24h-creation-guard-v1')
    throw Error('AUTH_RELEASE_NOT_VERIFIED');
  const client = (key = pub) =>
    createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  return authHandler(operation, {
    origins,
    pepper: required('PARTICIPANT_AUTH_PEPPER'),
    // Until trusted gateway forwarding is independently proved, use a shared
    // bucket. Never trust a caller-supplied X-Forwarded-For value for throttling.
    network: () => 'shared-gateway-v1',
    rpc: async (name, args) => {
      const { data, error } = await client(secret).rpc(name, args);
      if (error) throw Error('AUTH_STATE_UNAVAILABLE');
      return data;
    },
    send: async (email, kind, userId) => {
      const admin = client(secret);
      const before = await admin.auth.admin.getUserById(userId);
      if (
        before.error ||
        before.data.user?.email?.toLowerCase() !== email.toLowerCase()
      )
        return 'rejected';
      if (kind === 'invite') {
        const result = await admin.auth.admin.inviteUserByEmail(email);
        if (result.error)
          return result.error.status && result.error.status < 500
            ? 'rejected'
            : 'unknown';
        if (
          result.data.user?.id !== userId ||
          result.data.user.email?.toLowerCase() !== email.toLowerCase()
        )
          throw Error('AUTH_IDENTITY_MISMATCH');
      } else {
        const result = await client().auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });
        if (result.error)
          return result.error.status && result.error.status < 500
            ? 'rejected'
            : 'unknown';
      }
      return 'accepted';
    },
    verify: async (email, kind, code) => {
      const result = await client().auth.verifyOtp({
        email,
        token: code,
        type: kind,
      });
      if (result.error && (!result.error.status || result.error.status >= 500))
        throw Error('AUTH_VERIFICATION_UNCERTAIN');
      return result.error ? null : result.data;
    },
    organiser: async (authorization, userId) => {
      if (!authorization.startsWith('Bearer ')) throw Error('SIGN_IN_REQUIRED');
      const user = createClient(url, pub, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      if ((await user.auth.getUser()).error) throw Error('SIGN_IN_REQUIRED');
      const { data, error } = await user.rpc('auth_resend_recipient', {
        p_user: userId,
      });
      if (error || !data) throw Error('MFA_OR_ROLE_REQUIRED');
      return data;
    },
  });
}
