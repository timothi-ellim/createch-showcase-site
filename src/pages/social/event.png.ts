import { event } from '../../data/catalogue';
import { socialImage } from '../../lib/social-image';
export const prerender = true;
export async function GET() {
  return new Response(new Uint8Array(await socialImage(event)), {
    headers: { 'Content-Type': 'image/png' },
  });
}
