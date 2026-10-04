import type { PublicSnapshot, PublicProject } from './content-schema.ts';

type Event = PublicSnapshot['event'];
export const socialImagePath = (slug?: string) =>
  slug ? `/social/projects/${slug}.png` : '/social/event.png';

export function eventParagraphs(event: Event): string[] {
  return event.description?.split(/\n\s*\n/).filter(Boolean) ?? [];
}
export function eventIntroduction(event: Event): string {
  return (
    event.description?.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ??
    'A meeting point for creative technology, art, design and research.'
  );
}
export function eventSummary(event: Event): string {
  return `${event.shortDescription ?? eventIntroduction(event)} ${event.dateLabel}, ${event.startTime}–${event.endTime} (UK time).`;
}
export function pageDescription(event: Event, path: string): string {
  const descriptions: Record<string, string> = {
    '/explore/': `Explore the projects and researchers taking part in ${event.series} at ${event.venue.name}, ${event.venue.city}. Find work to save for your visit.`,
    '/about/': `About ${event.series}: ${event.shortDescription ?? eventIntroduction(event)}`,
    '/visit/': `Plan your visit to ${event.series}: ${event.dateLabel}, ${event.startTime}–${event.endTime} (UK time), ${event.venue.name}, ${event.venue.streetAddress}, ${event.venue.city}, ${event.venue.postalCode}.`,
    '/programme/': `See the current programme and confirmed project information for ${event.series}, ${event.dateLabel} at ${event.venue.name}, ${event.venue.city}.`,
    '/my-visit/': `Your saved ${event.series} projects, stored in this browser to help plan your visit.`,
    '/participants/': `Participant help for ${event.series}: access your invited workspace and prepare your project page for review.`,
    '/404/':
      'This page is unavailable. Browse the showcase to find a current project.',
  };
  return descriptions[path] ?? eventSummary(event);
}
export function eventDateTime(event: Event, time: string): string {
  const offset = new Intl.DateTimeFormat('en-GB', {
    timeZone: event.timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(`${event.date}T${time}:00Z`))
    .find((part) => part.type === 'timeZoneName')!.value;
  return `${event.date}T${time}:00${offset === 'GMT' ? '+00:00' : offset.slice(3)}`;
}
export function eventStructuredData(event: Event) {
  if (!event.publicSiteUrl) return null;
  const url = new URL('/', event.publicSiteUrl).href;
  return {
    '@context': 'https://schema.org',
    '@type': 'ExhibitionEvent',
    '@id': `${url}#event`,
    url,
    name: `${event.title} — ${event.series}`,
    description: event.description ?? eventSummary(event),
    startDate: eventDateTime(event, event.startTime),
    endDate: eventDateTime(event, event.endTime),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    image: [new URL(socialImagePath(), url).href],
    location: {
      '@type': 'Place',
      name: event.venue.name,
      address: {
        '@type': 'PostalAddress',
        streetAddress: event.venue.streetAddress,
        addressLocality: event.venue.city,
        postalCode: event.venue.postalCode,
        addressCountry: 'GB',
      },
    },
  };
}
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}
export function shareText(event: Event, project?: PublicProject): string {
  return [
    project ? `${project.title} — ${project.maker}` : event.title,
    event.series,
    project ? project.invitation || project.description : event.shortDescription,
    `${event.dateLabel}, ${event.startTime}–${event.endTime} (UK time).`,
    `${event.venue.name}, ${event.venue.streetAddress}, ${event.venue.city}, ${event.venue.postalCode}.`,
  ]
    .filter(Boolean)
    .join('\n');
}
