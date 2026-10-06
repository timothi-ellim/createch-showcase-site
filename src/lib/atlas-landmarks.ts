// Landmarks from the supplied plan (page 1); the café's identity/atrium
// location is corroborated by Leicester City Council, 12 March 2026.
// Coordinates are schematic areas, not surveyed positions or access claims.
export const atlasLandmarks = [
  {
    id: 'entrance',
    label: 'King Street entrance',
    shortLabel: 'Entrance',
    icon: 'door',
    description:
      'Arrive from King Street, then explore the spaces and works on the map.',
  },
  {
    id: 'cafe',
    label: 'Public café',
    shortLabel: 'Public café',
    icon: 'cup',
    description:
      'Canopy’s coffee shop and bakery in the atrium. Use it as a landmark as you explore the building.',
    note: 'The café marker indicates the arrival / atrium area, not a surveyed counter position.',
    source:
      'https://news.leicester.gov.uk/news-articles/2026/march/king-street-s-canopy-ready-to-become-hub-for-creativity/',
  },
  {
    id: 'lobby',
    label: 'Lobby',
    shortLabel: 'Lobby',
    icon: 'info',
    description:
      'The lobby connects the arrival area with the exhibition spaces. Choose a room to see the works proposed there.',
  },
  {
    id: 'toilets',
    label: 'Toilets near the lobby · stairs required',
    shortLabel: 'Toilets · stairs',
    icon: 'stairs',
    facility: true,
    location: 'Near the lobby / café',
    description:
      'Stairs are required to reach the toilets near the lobby and café. Two separate step-free WCs are also shown on the map.',
  },
  {
    id: 'wc-gallery',
    label: 'Step-free WC near the Gallery',
    shortLabel: 'Step-free WC',
    icon: 'wc',
    facility: true,
    location: 'Near Gallery',
    description: 'A step-free WC beside the Gallery-side passage.',
    note: 'Position is approximate. The schematic does not establish a continuous step-free route from the entrance.',
  },
  {
    id: 'wc-ws10',
    label: 'Step-free WC near WS10',
    shortLabel: 'Step-free WC',
    icon: 'wc',
    facility: true,
    location: 'Near WS10',
    description:
      'A separate step-free WC beside WS10, above the room in the 2D plan.',
    note: 'Position is approximate. The schematic does not establish a continuous step-free route from the entrance.',
  },
] as const;
export const atlasFacilities = atlasLandmarks.filter(
  (item) => 'facility' in item,
);
export type LandmarkId = (typeof atlasLandmarks)[number]['id'];
