import { event } from '../../data/catalogue';
import { websiteQr } from '../../lib/website-qr';
export const prerender = true;
export async function GET() {
  const bytes = await websiteQr(event.publicSiteUrl!, 'png') as Buffer;
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png' } });
}
