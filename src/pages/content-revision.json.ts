import { snapshot, isPreview } from '../data/catalogue';
export const prerender = true;
export function GET() {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      revision: snapshot.revision,
      preview: isPreview,
      projectIds: snapshot.projects.map((project) => project.id),
      projects: snapshot.projects.map((project) => ({
        id: project.id,
        slug: project.slug,
        approvedRevision: project.approvedRevision,
      })),
    }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}
