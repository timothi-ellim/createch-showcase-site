import { projects, snapshot } from './catalogue';
import { mapPreviewEnabled, placedProjects } from '../lib/exhibition-map';

// Publication is tied to the release's immutable source and approved catalogue.
export const hasMapPreview = mapPreviewEnabled(
  import.meta.env.MODE,
  snapshot.publicationStatus,
);
export const mapProjects = hasMapPreview ? placedProjects(projects) : [];
