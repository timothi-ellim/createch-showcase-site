import type { PublicProject } from './content-schema';

// A proposal transcribed from pages 1–4 of the supplied layout plan. No access,
// equipment, lighting, furniture or participant logistics are exported here.
// This is deliberately separate from the immutable approved project snapshots.
export const mapRooms = [
  {
    id: 'gallery',
    label: 'Gallery',
    number: '01',
    description: 'Explore the proposed installations in the Gallery.',
  },
  {
    id: 'ws09',
    label: 'WS09',
    number: '02',
    description: 'Explore the proposed installations in WS09.',
  },
  {
    id: 'ws10',
    label: 'WS10',
    number: '03',
    description: 'Explore the proposed installations in WS10.',
  },
] as const;
export type MapRoomId = (typeof mapRooms)[number]['id'];
export type MapPlacement = {
  projectId: string;
  roomId: MapRoomId;
  marker: string;
};
export const proposedPlacements: readonly MapPlacement[] = [
  { projectId: 'listen-scoundrels', roomId: 'gallery', marker: 'G1' },
  { projectId: 'plenography', roomId: 'gallery', marker: 'G2' },
  { projectId: 'eyeballs', roomId: 'gallery', marker: 'G3' },
  {
    projectId: 'machinimation-curation-station',
    roomId: 'ws09',
    marker: 'W9-1',
  },
  { projectId: 'an-unfinished-body', roomId: 'ws09', marker: 'W9-2' },
  { projectId: 'virtual-theatre', roomId: 'ws09', marker: 'W9-3' },
  { projectId: 'eight-out-of-ten-comments', roomId: 'ws10', marker: 'W10-1' },
  { projectId: 'where-a-tool-ends', roomId: 'ws10', marker: 'W10-2' },
  { projectId: 'social-xr', roomId: 'ws10', marker: 'W10-3' },
  { projectId: 'metaflower-the-kiri', roomId: 'ws10', marker: 'W10-4' },
  { projectId: 'metaverse-experiences', roomId: 'ws10', marker: 'W10-5' },
  { projectId: 'resonant-wardrobes', roomId: 'ws10', marker: 'W10-6' },
];

// Joining only against this release's public catalogue automatically excludes
// withdrawn/unpublished projects. Never join by participant-editable names.
export function placedProjects(projects: readonly PublicProject[]) {
  return proposedPlacements.flatMap((placement) => {
    const project = projects.find(
      (candidate) => candidate.id === placement.projectId,
    );
    return project ? [{ ...placement, project }] : [];
  });
}

// The organiser authorised this proposed atlas for publication on 5 October
// 2026. Its geometry/placements are frozen by each release's source commit;
// ordinary builds still require the exact approved content snapshot and receipt.
export function mapPreviewEnabled(mode: string, publicationStatus?: string) {
  return (
    mode === 'exhibition-preview' ||
    (mode === 'production' && publicationStatus === 'approved-public')
  );
}

export function mapProjectHref(projectId: string) {
  return `/map/?project=${encodeURIComponent(projectId)}`;
}
