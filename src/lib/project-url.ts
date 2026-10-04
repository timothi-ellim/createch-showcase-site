import type { PublicSnapshot } from './content-schema.ts';
export function publicOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    /localhost|workspace|staging/i.test(url.hostname) ||
    /^[^.]+\.[^.]+\.pages\.dev$/.test(url.hostname)
  )
    throw new Error('INVALID_PUBLIC_ORIGIN');
  return url.origin;
}
export function projectUrl(origin: string, slug: string): string {
  if (!/^[a-z][a-z0-9-]{1,79}$/.test(slug))
    throw new Error('INVALID_PROJECT_SLUG');
  return `${publicOrigin(origin)}/projects/${slug}/`;
}
export function snapshotOrigin(
  snapshot: Pick<PublicSnapshot, 'event' | 'publicationStatus'>,
): string {
  return snapshot.publicationStatus === 'synthetic-local-only'
    ? 'https://createch-preview.invalid'
    : publicOrigin(snapshot.event.publicSiteUrl ?? '');
}
export const qrPaths = (slug: string) => {
  if (!/^[a-z][a-z0-9-]{1,79}$/.test(slug))
    throw new Error('INVALID_PROJECT_SLUG');
  return {
    svg: `/generated/qr/${slug}.svg`,
    png: `/generated/qr/${slug}.png`,
    card: `/generated/signage/${slug}.pdf`,
    preview: `/generated/signage/${slug}.png`,
  };
};
