import { isPreview, event, projects } from '../data/catalogue';
export const prerender = true;
export function GET() {
  const base = event.publicSiteUrl?.replace(/\/$/, '') ?? '';
  const paths = [
    '/',
    '/explore/',
    '/visit/',
    ...projects.map((project) => `/projects/${project.slug}/`),
  ];
  const urls = isPreview
    ? ''
    : paths.map((path) => `<url><loc>${base}${path}</loc></url>`).join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
}
