// Explicit operational helper. Preparing a preview never invokes this file.
import { readFile } from 'node:fs/promises';
import { readSnapshot } from '../src/lib/content-schema.ts';
import { serviceRPC } from '../editorial/reminders.ts';
const path = process.argv[process.argv.indexOf('--snapshot') + 1];
if (
  !process.argv.includes('--snapshot') ||
  process.env.REMINDERS_SETUP_AUTHORISED !== 'true'
)
  throw new Error('EXPLICIT_REMINDER_SETUP_AUTHORISATION_REQUIRED');
const snapshot = readSnapshot(JSON.parse(await readFile(path, 'utf8')));
if (
  snapshot.publicationStatus !== 'approved-public' ||
  !snapshot.event.publicSiteUrl
)
  throw new Error('VERIFIED_PUBLIC_EVENT_REQUIRED');
const rpc = serviceRPC(
  process.env.REMINDERS_SUPABASE_URL ?? '',
  process.env.REMINDERS_SUPABASE_SECRET ?? '',
);
await rpc('reminder_configure', {
  p_event: snapshot.event,
  p_origin: new URL(snapshot.event.publicSiteUrl).origin,
  p_revision: snapshot.revision,
  p_ready: process.argv.includes('--delivery-verified'),
});
console.log(
  'Campaign configured; use the authenticated organiser screen to review its paused state. No mail was sent.',
);
