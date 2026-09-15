import { event, isPreview } from '../data/catalogue';
export const prerender = true;
export function GET() {
  // Public hosting can point to the separately protected editing workspace.
  // The standalone workspace uses its own route tree and never emits this file.
  const origin = event.participantWorkspaceUrl
    ? new URL(event.participantWorkspaceUrl).origin
    : null;
  const lines =
    !isPreview && origin && origin !== new URL(event.publicSiteUrl!).origin
      ? ['participant', 'organiser'].flatMap((path) => [
          `/${path} ${origin}/${path}/ 302`,
          `/${path}/* ${origin}/${path}/:splat 302`,
        ])
      : [];
  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain' },
  });
}
