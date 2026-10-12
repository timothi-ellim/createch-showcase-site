import { snapshot } from '../../data/catalogue';
import { sharingPack } from '../../lib/sharing-pack';
export const prerender = true;
export async function GET() {
  return new Response(await sharingPack(snapshot), { headers: { 'Content-Type':'application/zip', 'Content-Disposition':'attachment; filename="createch-sharing-pack.zip"' } });
}
