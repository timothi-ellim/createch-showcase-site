// Explicit maintenance invocation. Never runs on page views or sends email.
import { createClient } from '@supabase/supabase-js';
import { checkPortalEnvironment } from '../src/lib/portal-contract.ts';
const {
  SUPABASE_URL: url,
  SUPABASE_SECRET_KEY: secret,
  PORTAL_ENVIRONMENT: environment,
  PORTAL_APP_ORIGIN: origin,
} = process.env;
if (!url || !secret || !environment || !origin)
  throw Error('CLEANUP_CONFIGURATION_REQUIRED');
checkPortalEnvironment(url, environment, origin);
const client = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await client.rpc('auth_cleanup');
if (error) throw Error('AUTH_CLEANUP_FAILED');
console.log(
  'Expired sign-in state maintenance completed. No accounts or drafts deleted.',
);
