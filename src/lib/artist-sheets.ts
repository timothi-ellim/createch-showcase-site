import pack from '../data/artist-sheets.json' with { type: 'json' };
import type { PublicProject, PublicSnapshot } from './content-schema.ts';

export function hasCurrentArtistSheetEdition(snapshot: Pick<PublicSnapshot, 'revision' | 'publicationStatus'>): boolean {
  return snapshot.publicationStatus === 'approved-public' && snapshot.revision === pack.sourceRevision;
}

// A reviewed print edition is only offered alongside its exact approved content.
// The dated file URLs remain stable for people who have already downloaded it.
export function artistInformationSheet(
  snapshot: Pick<PublicSnapshot, 'revision' | 'publicationStatus'>,
  project: Pick<PublicProject, 'id' | 'slug' | 'approvedRevision'>,
): string | undefined {
  if (!hasCurrentArtistSheetEdition(snapshot))
    return undefined;
  const sheet = pack.sheets.find(item => item.id === project.id && item.slug === project.slug);
  return sheet?.approvedRevision === project.approvedRevision ? sheet.path : undefined;
}
