import { event, isSynthetic } from '../../data/catalogue';
import { websiteQr } from '../../lib/website-qr';
export const prerender = true;
export async function GET() {
  return new Response(await websiteQr(isSynthetic ? 'https://createch-preview.invalid/' : event.publicSiteUrl!, 'svg') as string, { headers: { 'Content-Type': 'image/svg+xml' } });
}
