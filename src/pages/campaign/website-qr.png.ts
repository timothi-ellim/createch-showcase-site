import { event, isSynthetic } from '../../data/catalogue';
import { websiteQr } from '../../lib/website-qr';
export const prerender = true;
export async function GET() {
  const bytes = await websiteQr(isSynthetic ? 'https://createch-preview.invalid/' : event.publicSiteUrl!, 'png') as Buffer;
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png' } });
}
