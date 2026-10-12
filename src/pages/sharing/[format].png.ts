import type { APIContext } from 'astro';
import { event } from '../../data/catalogue';
import { sharingFormats, sharingImage, type SharingFormat } from '../../lib/sharing-pack';
export const prerender = true;
export function getStaticPaths() { return sharingFormats.map(f=>({params:{format:f.id}})); }
export async function GET({params}: APIContext) {
  return new Response(new Uint8Array(await sharingImage(event,params.format as SharingFormat)), {headers:{'Content-Type':'image/png'}});
}
