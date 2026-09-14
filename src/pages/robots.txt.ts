import { isPreview, event } from '../data/catalogue';
export const prerender = true;
export function GET() {
  return new Response(
    isPreview
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\nSitemap: ${event.publicSiteUrl!.replace(/\/$/, '')}/sitemap.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
