import { event, snapshot } from '../../data/catalogue';
import { snapshotOrigin } from '../../lib/project-url';
import { calendarFile } from '../../lib/event-calendar';
export const prerender = true;
export function GET() {
  return new Response(calendarFile(event, snapshotOrigin(snapshot)), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition':
        'attachment; filename="createch-showcase-2026.ics"',
    },
  });
}
