// Public links supplied by the organiser on 13 October 2026.
// Only Canopy's event listing identifies the showcase itself.
export const eventLinks = {
  canopy: {
    href: 'https://canopy.leicestercreative.business/events/createch-showcase-2026/',
    label: 'CreaTech Showcase on Canopy',
    description: 'Read the event listing on the venue’s website.',
    category: 'Venue announcement',
    action: 'Read the Canopy listing',
  },
  lcb: {
    href: 'https://linktr.ee/lcbdepot',
    label: 'LCB Depot on Linktree',
    description: 'Find LCB’s latest events, news and social channels.',
    category: 'Community & events',
    action: 'Explore LCB’s links',
  },
  tracy: {
    href: 'https://www.linkedin.com/posts/tgharwood_leicester-createch-activity-7515688098064691200-utxM',
    label: 'Tracy Harwood on LinkedIn',
    description: 'Tracy introduces the doctoral research showcase at Canopy and invites visitors to meet the researchers.',
    category: 'Social announcement',
    action: 'Read Tracy’s post',
  },
} as const;

export const venueLinks = [eventLinks.canopy, eventLinks.lcb];
export const newsLinks = [eventLinks.tracy, ...venueLinks];
