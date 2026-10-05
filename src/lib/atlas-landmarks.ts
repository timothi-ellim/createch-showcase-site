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
    label: 'Toilets',
    shortLabel: 'Toilets',
    icon: 'wc',
    description:
      'Shown beside the lobby on the supplied layout plan. Follow venue signs for the facilities.',
  },
] as const;
export type LandmarkId = (typeof atlasLandmarks)[number]['id'];
