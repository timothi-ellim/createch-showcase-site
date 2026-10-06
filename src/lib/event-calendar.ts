import { eventInstants, type EventTime } from './event-time.ts';
export interface CalendarEvent extends EventTime {
  title: string;
  series: string;
  shortDescription?: string;
  venue: {
    name: string;
    streetAddress: string;
    city: string;
    postalCode: string;
  };
}
export const calendarPath = '/calendar/createch-showcase-2026.ics';
export const eventAddress = (event: CalendarEvent) =>
  [
    event.venue.name,
    event.venue.streetAddress,
    event.venue.city,
    event.venue.postalCode,
  ].join(', ');
const stamp = (instant: number) =>
  new Date(instant)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
const escape = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
function fold(line: string) {
  const lines: string[] = [];
  let chunk = '',
    size = 0;
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length;
    if (size + bytes > 75) {
      lines.push(chunk);
      chunk = ' ';
      size = 1;
    }
    chunk += char;
    size += bytes;
  }
  lines.push(chunk);
  return lines.join('\r\n');
}
export function calendarFile(
  event: CalendarEvent,
  origin: string,
  generatedAt = Date.now(),
) {
  const { start, end } = eventInstants(event);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CreaTech Showcase//Event calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:createch-showcase-2026@createch-showcase.pages.dev',
    // Actual creation time of this calendar representation, not a live-update claim.
    `DTSTAMP:${stamp(generatedAt)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(`${event.title} · ${event.series}`)}`,
    `LOCATION:${escape(eventAddress(event))}`,
    `DESCRIPTION:${escape(`${event.shortDescription ?? event.title}\nPlan your visit: ${origin}/visit/\nPlease check the website for the latest visitor information.`)}`,
    `URL:${origin}/visit/`,
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(event.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}
export function googleCalendarUrl(event: CalendarEvent, origin: string) {
  const { start, end } = eventInstants(event);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${event.title} · ${event.series}`,
    dates: `${stamp(start)}/${stamp(end)}`,
    ctz: event.timeZone,
    location: eventAddress(event),
    details: `${event.shortDescription ?? event.title}\nPlan your visit: ${origin}/visit/`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
